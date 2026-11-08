import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../../src/core/store/messages.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";

const dirs: string[] = [];
const databases: Array<{ close(): void }> = [];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "aechat-messages-"));
  dirs.push(dir);
  const path = join(dir, "aechat.db");
  const db = openDatabase(path);
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  sessions.create({
    sessionId: "from-session",
    displayName: "from",
    client: "claude-code",
    project: "/tmp/from",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-11-06T00:00:00.000Z",
  });
  sessions.create({
    sessionId: "to-session",
    displayName: "to",
    client: "claude-code",
    project: "/tmp/to",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-11-06T00:00:00.000Z",
  });
  return {
    db,
    path,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    sessions,
    bindings: new TransportBindingRepository(db),
  };
}

function insertMessage(
  messages: MessageRepository,
  overrides: Partial<Parameters<MessageRepository["insert"]>[0]> = {},
) {
  return messages.insert({
    messageId: "message-1",
    kind: "notify",
    fromSession: "from-session",
    toSession: "to-session",
    body: "hello",
    createdAt: "2026-11-06T00:00:00.000Z",
    ...overrides,
  });
}

function insertDelivery(
  deliveries: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository["insert"]>[0]> = {},
) {
  return deliveries.insert({
    deliveryId: "delivery-1",
    messageId: "message-1",
    sessionId: "to-session",
    ...overrides,
  });
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("MessageRepository", () => {
  it("inserts and reads an immutable message", () => {
    const { messages } = setup();
    const message = insertMessage(messages);

    expect(message).toMatchObject({
      messageId: "message-1",
      kind: "notify",
      fromSession: "from-session",
      toSession: "to-session",
      body: "hello",
      dedupKey: null,
      expiresAt: null,
    });
    expect(messages.get("message-1")).toEqual(message);
  });

  it("lists messages involving a session", () => {
    const { messages } = setup();
    insertMessage(messages, { messageId: "message-1" });
    insertMessage(messages, {
      messageId: "message-2",
      fromSession: "to-session",
      toSession: "from-session",
      body: "reply",
    });

    expect(messages.listForSession("to-session")).toHaveLength(2);
    expect(messages.listForSession("missing")).toHaveLength(0);
  });
});

describe("DeliveryRepository claim", () => {
  it("returns each delivery at most once to concurrent callers", () => {
    const { path, messages, deliveries } = setup();
    insertMessage(messages);
    insertDelivery(deliveries);

    const db2 = openDatabase(path);
    databases.push(db2);
    const deliveries2 = new DeliveryRepository(db2);

    const first = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:01:00.000Z",
      leaseSeconds: 30,
    });
    const second = deliveries2.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:01:00.000Z",
      leaseSeconds: 30,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0]?.deliveryToken).toBeTypeOf("string");
  });

  it("includes notify_failed and skips expired messages", () => {
    const { messages, deliveries } = setup();
    insertMessage(messages, { messageId: "message-1" });
    insertDelivery(deliveries, {
      deliveryId: "delivery-1",
      messageId: "message-1",
      status: "notify_failed",
    });
    insertMessage(messages, {
      messageId: "message-2",
      expiresAt: "2026-11-06T00:00:30.000Z",
    });
    insertDelivery(deliveries, {
      deliveryId: "delivery-2",
      messageId: "message-2",
    });

    const claimed = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:01:00.000Z",
      leaseSeconds: 30,
    });

    expect(claimed.map((delivery) => delivery.deliveryId)).toEqual([
      "delivery-1",
    ]);
    expect(deliveries.get("delivery-2")?.status).toBe("expired");
  });

  it("re-delivers after lease expiry, up to max attempts", () => {
    const { messages, deliveries } = setup();
    insertMessage(messages);
    insertDelivery(deliveries);

    const first = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:01:00.000Z",
      leaseSeconds: 30,
    });
    const second = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:02:00.000Z",
      leaseSeconds: 30,
    });
    const third = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:03:00.000Z",
      leaseSeconds: 30,
    });
    const fourth = deliveries.claim({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:04:00.000Z",
      leaseSeconds: 30,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(third).toHaveLength(1);
    expect(fourth).toHaveLength(0);
    expect(deliveries.get("delivery-1")?.status).toBe("dead_letter");
    expect(deliveries.get("delivery-1")?.attempts).toBe(3);
  });

  it("ack is idempotent and scoped to the session", () => {
    const { messages, deliveries } = setup();
    insertMessage(messages);
    insertDelivery(deliveries);
    const [claimed] = deliveries.claim({
      sessionId: "to-session",
      limit: 1,
      now: "2026-11-06T00:01:00.000Z",
      leaseSeconds: 30,
    });
    const token = claimed?.deliveryToken as string;

    expect(
      deliveries.ack(token, "other-session", "2026-11-06T00:01:10.000Z"),
    ).toBe(false);
    expect(
      deliveries.ack(token, "to-session", "2026-11-06T00:01:10.000Z"),
    ).toBe(true);
    expect(
      deliveries.ack(token, "to-session", "2026-11-06T00:01:11.000Z"),
    ).toBe(true);
    expect(deliveries.get("delivery-1")?.status).toBe("acked");
    expect(deliveries.get("delivery-1")?.ackedAt).toBe(
      "2026-11-06T00:01:11.000Z",
    );
  });
});
