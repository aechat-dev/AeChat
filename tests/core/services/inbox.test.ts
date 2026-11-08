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

function setup(options: { events?: EventRepository } = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const events = options.events ?? new EventRepository(db);
  const transport = new FakeTransportAdapter();
  let tick = 0;
  const now = () =>
    `2026-11-06T00:0${Math.floor(tick / 60)}:${String(tick++ % 60).padStart(2, "0")}.000Z`;
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

  return { service, messages, deliveries, sessions, events };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("DeliveryService.inbox", () => {
  it("records an expire event when a delivery TTL lapses", async () => {
    const { service, events } = setup();
    const sent = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "gone",
      ttlSeconds: 1,
      now: "2026-11-06T00:00:00.000Z",
    });

    await service.inbox({
      sessionId: "to-session",
      limit: 10,
      now: "2026-11-06T00:00:10.000Z",
    });

    const expire = events
      .listForMessage(sent.messageId)
      .find((event) => event.event === "expire");
    expect(expire).toMatchObject({
      messageId: sent.messageId,
      deliveryId: sent.deliveryId,
      sessionId: "to-session",
    });
    expect(JSON.parse(expire?.dataJson ?? "{}")).toMatchObject({
      reason: "ttl",
    });
  });

  it("rolls back the claim when the inbox_claim event cannot be written", async () => {
    const events = {
      record: vi.fn((input: { event: string }) => {
        if (input.event === "inbox_claim") {
          throw new Error("event write failed");
        }
        return "event";
      }),
    } as unknown as EventRepository;
    const { service, deliveries } = setup({ events });
    const sent = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "claim me",
    });

    await expect(
      service.inbox({ sessionId: "to-session", limit: 1 }),
    ).rejects.toThrow("event write failed");
    expect(deliveries.get(sent.deliveryId)?.status).toBe("notified");
  });

  it("records a dead_letter event after the lease and attempt limit", async () => {
    const { service, events } = setup();
    const sent = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "never acked",
      now: "2026-11-06T00:00:00.000Z",
    });

    for (const time of ["00:01", "00:12", "00:23", "00:34"]) {
      await service.inbox({
        sessionId: "to-session",
        limit: 1,
        now: `2026-11-06T${time}:00.000Z`,
      });
    }

    expect(
      events.listForMessage(sent.messageId).map((event) => event.event),
    ).toContain("dead_letter");
  });

  it("claims and returns delivery_token", async () => {
    const { service } = setup();
    const sent = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    const items = await service.inbox({ sessionId: "to-session", limit: 10 });

    expect(items).toHaveLength(1);
    expect(items[0]?.message.messageId).toBe(sent.messageId);
    expect(items[0]?.delivery.status).toBe("delivered");
    expect(items[0]?.deliveryToken).toBeTypeOf("string");
  });

  it("two concurrent inbox calls do not return the same delivery", async () => {
    const { service } = setup();
    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    const [first, second] = await Promise.all([
      service.inbox({ sessionId: "to-session", limit: 10 }),
      service.inbox({ sessionId: "to-session", limit: 10 }),
    ]);

    expect(first.length + second.length).toBe(1);
  });

  it("peek does not claim or return a token", async () => {
    const { service } = setup();
    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    const peeked = await service.inbox({
      sessionId: "to-session",
      limit: 10,
      peek: true,
    });
    expect(peeked).toHaveLength(1);
    expect(peeked[0]?.deliveryToken).toBeNull();
    expect(peeked[0]?.delivery.status).toBe("notified");
  });

  it("peek hides a stale token from an expired lease", async () => {
    const { service } = setup();
    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });
    const [claimed] = await service.inbox({
      sessionId: "to-session",
      limit: 1,
      now: "2026-11-06T00:10:00.000Z",
    });
    expect(claimed?.deliveryToken).toBeTypeOf("string");

    const peeked = await service.inbox({
      sessionId: "to-session",
      limit: 1,
      peek: true,
      now: "2026-11-06T00:11:00.000Z",
    });
    expect(peeked).toHaveLength(1);
    expect(peeked[0]?.deliveryToken).toBeNull();
    expect(peeked[0]?.delivery.deliveryToken).toBeNull();
  });
});

describe("DeliveryService.wait", () => {
  it("returns immediately when an unread message exists", async () => {
    const { service } = setup();
    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    const items = await service.wait({
      sessionId: "to-session",
      timeoutSeconds: 1,
    });
    expect(items).toHaveLength(1);
  });

  it("returns null after timeout when there is nothing to claim", async () => {
    const { service } = setup();
    const started = Date.now();
    const items = await service.wait({
      sessionId: "to-session",
      timeoutSeconds: 0.2,
    });
    expect(items).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});
