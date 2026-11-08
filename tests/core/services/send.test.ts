import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryService } from "../../../src/core/services/delivery-service.js";
import { openDatabase } from "../../../src/core/store/db.js";
import { EventRepository } from "../../../src/core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../../src/core/store/messages.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../../src/core/transport/fake.js";

const databases: Array<{ close(): void }> = [];

function setup(
  options: ConstructorParameters<typeof FakeTransportAdapter>[0] = {},
) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter(options);
  let tick = 0;
  const now = () => `2026-11-06T00:00:0${tick++}.000Z`;
  const service = new DeliveryService({
    db,
    messages,
    deliveries,
    sessions,
    bindings,
    transport,
    events,
    now,
  });

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
  bindings.create({
    bindingId: "from-binding",
    sessionId: "from-session",
    transport: "fake",
    address: "aechat-from",
    state: "bound",
  });
  bindings.create({
    bindingId: "to-binding",
    sessionId: "to-session",
    transport: "fake",
    address: "aechat-to",
    state: "bound",
  });

  return { service, transport, messages, deliveries, sessions, events };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("DeliveryService.send", () => {
  it("stores message and delivery, then notifies", async () => {
    const { service, transport, messages, deliveries } = setup();
    const notify = vi.spyOn(transport, "notify");

    const result = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    expect(result).toMatchObject({ status: "notified" });
    expect(messages.get(result.messageId)?.body).toBe("hello");
    expect(deliveries.get(result.deliveryId)?.status).toBe("notified");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ address: "aechat-to" }),
      expect.objectContaining({
        messageId: result.messageId,
        fromAddress: "aechat-from",
      }),
    );
  });

  it("returns the original message for the same dedup key and target", async () => {
    const { service, messages } = setup();
    const input = {
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify" as const,
      body: "hello",
      dedupKey: "key-1",
    };

    const first = await service.send(input);
    const second = await service.send(input);

    expect(second.messageId).toBe(first.messageId);
    expect(messages.listForSession("to-session")).toHaveLength(1);
  });

  it("rejects the same dedup key with a different target or body", async () => {
    const { service, sessions } = setup();
    sessions.create({
      sessionId: "other-session",
      displayName: "other",
      client: "claude-code",
      project: "/tmp/other",
      lastSeenAt: "2026-11-06T00:00:00.000Z",
      createdAt: "2026-11-06T00:00:00.000Z",
    });

    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
      dedupKey: "key-1",
    });

    await expect(
      service.send({
        fromSession: "from-session",
        toSession: "to-session",
        kind: "notify",
        body: "different",
        dedupKey: "key-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    await expect(
      service.send({
        fromSession: "from-session",
        toSession: "other-session",
        kind: "notify",
        body: "hello",
        dedupKey: "key-1",
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("dedup resend reports the original delivery status", async () => {
    const { service } = setup();
    const input = {
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify" as const,
      body: "hello",
      dedupKey: "key-acked",
    };
    await service.send(input);
    const [item] = await service.inbox({ sessionId: "to-session", limit: 1 });
    expect(item?.deliveryToken).toBeTypeOf("string");
    expect(
      service.ack({
        sessionId: "to-session",
        token: item?.deliveryToken as string,
      }),
    ).toBe(true);

    const again = await service.send(input);
    expect(again.status).toBe("acked");
  });

  it("notify failure leaves delivery notify_failed and message readable", async () => {
    const { service, transport, messages, deliveries } = setup({
      notifyFails: true,
    });
    vi.spyOn(transport, "notify");

    const result = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    expect(result).toMatchObject({ status: "notify_failed" });
    expect(result.error).toContain("fake notify failure");
    expect(messages.get(result.messageId)?.body).toBe("hello");
    expect(deliveries.get(result.deliveryId)?.status).toBe("notify_failed");
  });

  it("validates body size, TTL and target state", async () => {
    const { service, sessions } = setup();
    await expect(
      service.send({
        fromSession: "from-session",
        toSession: "to-session",
        kind: "notify",
        body: "x".repeat(16 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ code: "invalid_body" });

    await expect(
      service.send({
        fromSession: "from-session",
        toSession: "to-session",
        kind: "notify",
        body: "hello",
        ttlSeconds: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });

    sessions.markLeft("to-session", "2026-11-06T00:00:00.000Z");
    await expect(
      service.send({
        fromSession: "from-session",
        toSession: "to-session",
        kind: "notify",
        body: "hello",
      }),
    ).rejects.toMatchObject({ code: "target_left" });
  });
});
