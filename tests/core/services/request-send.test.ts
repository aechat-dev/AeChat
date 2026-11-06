import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryService } from "../../../src/core/services/delivery-service.js";
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
  const service = new DeliveryService({
    db,
    messages,
    deliveries,
    requests,
    sessions,
    bindings,
    transport,
    events,
    now: () => "2026-11-07T00:00:00.000Z",
  });

  for (const [sessionId, name] of [
    ["from-session", "from"],
    ["to-session", "to"],
  ] as const) {
    sessions.create({
      sessionId,
      displayName: name,
      client: "claude-code",
      project: `/tmp/${name}`,
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    bindings.create({
      bindingId: `binding-${sessionId}`,
      sessionId,
      transport: "fake",
      address: `aechat-${sessionId}`,
      state: "bound",
    });
  }

  return { service, transport, messages, deliveries, requests, events };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("DeliveryService.sendRequest", () => {
  it("writes message, delivery and request in one transaction", async () => {
    const { service, messages, deliveries, requests } = setup();

    const result = await service.sendRequest({
      fromSession: "from-session",
      toSession: "to-session",
      body: "please reply",
      deadlineSeconds: 60,
    });

    const message = messages.get(result.messageId);
    expect(message?.kind).toBe("request");
    expect(message?.requestId).toBe(result.messageId);
    expect(message?.expiresAt).toBeNull();
    expect(deliveries.get(result.deliveryId)?.messageId).toBe(result.messageId);
    expect(requests.get(result.messageId)).toMatchObject({
      requestId: result.messageId,
      requesterSession: "from-session",
      targetSession: "to-session",
      status: "open",
      closeReason: null,
      replyMessageId: null,
      deadline: "2026-11-07T00:01:00.000Z",
    });
  });

  it("a notify failure after commit leaves the request intact, not orphaned", async () => {
    const { service, transport, messages, requests } = setup();
    vi.spyOn(transport, "notify").mockRejectedValueOnce(
      new Error("transport crashed"),
    );

    const result = await service.sendRequest({
      fromSession: "from-session",
      toSession: "to-session",
      body: "please reply",
    });

    expect(result.status).toBe("notify_failed");
    expect(messages.get(result.messageId)?.kind).toBe("request");
    expect(requests.get(result.messageId)?.status).toBe("open");
  });

  it("keeps request dedup scoped to the original request", async () => {
    const { service, messages, requests } = setup();
    const input = {
      fromSession: "from-session",
      toSession: "to-session",
      body: "please reply",
      dedupKey: "request-key",
    };

    const first = await service.sendRequest(input);
    const second = await service.sendRequest(input);

    expect(second.messageId).toBe(first.messageId);
    expect(messages.listForSession("to-session")).toHaveLength(1);
    expect(requests.get(first.messageId)?.status).toBe("open");
  });
});
