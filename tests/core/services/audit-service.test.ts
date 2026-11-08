import { homedir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { AuditService } from "../../../src/core/services/audit-service.js";
import { DeliveryService } from "../../../src/core/services/delivery-service.js";
import { RequestService } from "../../../src/core/services/request-service.js";
import { openDatabase } from "../../../src/core/store/db.js";
import { EventRepository } from "../../../src/core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../../src/core/store/messages.js";
import { RequestRepository } from "../../../src/core/store/requests.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../../src/core/transport/fake.js";

const databases: Array<{ close(): void }> = [];

function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const requests = new RequestRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter();
  let tick = 0;
  const now = () => `2026-11-07T00:00:${String(tick++).padStart(2, "0")}.000Z`;
  const delivery = new DeliveryService({
    db,
    messages,
    deliveries,
    requests,
    sessions,
    bindings,
    transport,
    events,
    now,
  });
  const request = new RequestService({
    db,
    messages,
    deliveries,
    requests,
    delivery,
    events,
    now,
  });
  const audit = new AuditService({
    messages,
    deliveries,
    requests,
    sessions,
    events,
    now,
  });

  for (const [id, name] of [
    ["a", "alice"],
    ["b", "bob"],
    ["c", "carol"],
  ] as const) {
    sessions.create({
      sessionId: id,
      displayName: name,
      client: "claude-code",
      project: `/tmp/${name}`,
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    bindings.create({
      bindingId: `binding-${id}`,
      sessionId: id,
      transport: "fake",
      address: `aechat-${id}`,
      state: "bound",
    });
  }

  return {
    delivery,
    request,
    audit,
    events,
    messages,
    sessions,
    deliveries,
  };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("AuditService.log", () => {
  it("reconstructs stored, notified, delivered, acked and replied without the body", async () => {
    const { delivery, request, audit } = setup();
    const sent = await delivery.sendRequest({
      fromSession: "a",
      toSession: "c",
      body: "sensitive request body",
      deadlineSeconds: 300,
    });
    const [claimed] = await delivery.inbox({ sessionId: "c", limit: 1 });
    await delivery.ack({
      sessionId: "c",
      token: claimed?.deliveryToken as string,
    });
    await delivery.ack({
      sessionId: "c",
      token: claimed?.deliveryToken as string,
    });
    await request.reply({
      sessionId: "c",
      requestId: sent.messageId,
      body: "sensitive reply body",
    });

    const entry = audit.log({ messageId: sent.messageId });
    const events = entry.chain.map((item) => item.stage);

    expect(events).toEqual(
      expect.arrayContaining([
        "stored",
        "notified",
        "delivered",
        "acked",
        "replied",
      ]),
    );
    expect(events.filter((event) => event === "acked")).toHaveLength(1);
    expect(entry.requestStatus).toBe("replied");
    expect(entry.deliveryStatus).toBe("acked");
    expect(entry.replyMessageId).toBeTypeOf("string");
    expect(JSON.stringify(entry)).not.toContain("sensitive request body");
    expect(JSON.stringify(entry)).not.toContain("sensitive reply body");

    const replyEntry = audit.log({
      messageId: entry.replyMessageId as string,
    });
    expect(replyEntry.chain.map((item) => item.stage)).toEqual(
      expect.arrayContaining([
        "stored",
        "notified",
        "delivered",
        "acked",
        "replied",
      ]),
    );
  });

  it("shows the expired state without inventing an event", async () => {
    const { delivery, audit } = setup();
    const sent = await delivery.send({
      fromSession: "a",
      toSession: "c",
      kind: "notify",
      body: "gone",
      ttlSeconds: 1,
      now: "2026-11-07T00:00:00.000Z",
    });
    await delivery.inbox({
      sessionId: "c",
      limit: 10,
      now: "2026-11-07T00:00:10.000Z",
    });

    const entry = audit.log({ messageId: sent.messageId });
    expect(entry.deliveryStatus).toBe("expired");
    expect(entry.chain.map((item) => item.stage)).not.toContain("expired");
  });

  it("records a log_read event only against --as, not inside the chain", async () => {
    const { delivery, audit, events } = setup();
    const sent = await delivery.send({
      fromSession: "a",
      toSession: "c",
      kind: "notify",
      body: "hello",
    });

    const entry = audit.log({ messageId: sent.messageId, asSession: "b" });

    expect(entry.chain.map((item) => item.stage)).not.toContain("log_read");
    expect(events.listForSession("b").map((item) => item.event)).toContain(
      "log_read",
    );
  });

  it("does not expose unredacted error details through log", async () => {
    const { delivery, audit, events } = setup();
    const sent = await delivery.send({
      fromSession: "a",
      toSession: "c",
      kind: "notify",
      body: "hello",
    });
    events.record({
      event: "notify_fail",
      sessionId: "c",
      messageId: sent.messageId,
      errorDetail: `token=super-secret ${homedir()}/private ${"x".repeat(3000)}`,
    });

    const entry = audit.log({ messageId: sent.messageId });
    const serialized = JSON.stringify(entry);

    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain(homedir());
    expect(entry.chain.at(-1)?.errorDetail?.length).toBeLessThanOrEqual(2048);
  });

  it("redacts last_error through the same path", async () => {
    const { delivery, audit, deliveries } = setup();
    const sent = await delivery.send({
      fromSession: "a",
      toSession: "c",
      kind: "notify",
      body: "hello",
    });
    deliveries.markNotifyFailed(
      sent.deliveryId,
      `Authorization: Basic basic-secret ${homedir()}/private`,
    );

    const entry = audit.log({ messageId: sent.messageId });
    const serialized = JSON.stringify(entry);

    expect(entry.deliveryStatus).toBe("notify_failed");
    expect(serialized).not.toContain("basic-secret");
    expect(serialized).not.toContain(homedir());
  });
});

describe("AuditService.history", () => {
  it("returns only messages sent or received by the requested session", async () => {
    const { delivery, audit } = setup();
    await delivery.send({
      fromSession: "a",
      toSession: "b",
      kind: "notify",
      body: "from a to b",
    });
    await delivery.send({
      fromSession: "b",
      toSession: "c",
      kind: "notify",
      body: "from b to c",
    });
    await delivery.send({
      fromSession: "c",
      toSession: "a",
      kind: "notify",
      body: "from c to a",
    });

    const b = audit.history({ sessionId: "b", limit: 10 });
    const bodies = b.messages.map((item) => item.body).sort();

    expect(bodies).toEqual(["from a to b", "from b to c"]);
    expect(b.messages.map((item) => item.direction).sort()).toEqual([
      "in",
      "out",
    ]);
  });

  it("does not treat reading history as a heartbeat", async () => {
    const { audit, sessions } = setup();
    const before = sessions.get("b")?.lastSeenAt;

    audit.history({ sessionId: "b" });

    expect(sessions.get("b")?.lastSeenAt).toBe(before);
  });
});
