import { afterEach, describe, expect, it } from "vitest";

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

function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter();
  let tick = 0;
  const now = () => `2026-11-06T00:00:${String(tick++).padStart(2, "0")}.000Z`;
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

  return { service };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("DeliveryService.ack", () => {
  it("is idempotent, scoped to the session, and redelivers after lease", async () => {
    const { service } = setup();
    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    const [first] = await service.inbox({ sessionId: "to-session", limit: 1 });
    const token = first?.deliveryToken as string;
    expect(token).toBeTypeOf("string");

    expect(service.ack({ sessionId: "other-session", token })).toBe(false);
    expect(service.ack({ sessionId: "to-session", token })).toBe(true);
    expect(service.ack({ sessionId: "to-session", token })).toBe(true);

    const afterAck = await service.inbox({ sessionId: "to-session", limit: 1 });
    expect(afterAck).toHaveLength(0);

    await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "second",
    });
    const [leased] = await service.inbox({
      sessionId: "to-session",
      limit: 1,
      now: "2026-11-06T00:10:00.000Z",
    });
    expect(leased).toBeDefined();

    const redelivered = await service.inbox({
      sessionId: "to-session",
      limit: 1,
      now: "2026-11-06T00:11:00.000Z",
    });
    expect(redelivered).toHaveLength(1);
    expect(redelivered[0]?.message.body).toBe("second");
  });
});

describe("DeliveryService.show", () => {
  it("lets the sender read and the receiver only after delivery", async () => {
    const { service } = setup();
    const sent = await service.send({
      fromSession: "from-session",
      toSession: "to-session",
      kind: "notify",
      body: "hello",
    });

    expect(
      service.show({ sessionId: "from-session", messageId: sent.messageId }).body,
    ).toBe("hello");
    expect(() =>
      service.show({ sessionId: "to-session", messageId: sent.messageId }),
    ).toThrow();

    await service.inbox({ sessionId: "to-session", limit: 1 });
    expect(
      service.show({ sessionId: "to-session", messageId: sent.messageId }).body,
    ).toBe("hello");
    expect(() =>
      service.show({ sessionId: "other-session", messageId: sent.messageId }),
    ).toThrow();
  });
});
