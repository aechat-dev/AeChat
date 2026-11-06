import { afterEach, describe, expect, it } from "vitest";

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

function setup(options: { notifyFails?: boolean } = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const requests = new RequestRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter({
    notifyFails: options.notifyFails ?? false,
  });
  const delivery = new DeliveryService({
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
  const service = new RequestService({
    db,
    messages,
    deliveries,
    requests,
    delivery,
    events,
    now: () => "2026-11-07T00:00:00.000Z",
  });

  for (const [sessionId, name] of [
    ["requester", "requester"],
    ["target", "target"],
    ["other", "other"],
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

  return { delivery, service, messages, deliveries, requests };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("RequestService.wait", () => {
  it("returns replied with the linked reply", async () => {
    const { delivery, service, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });
    const reply = await service.reply({
      sessionId: "target",
      requestId: request.messageId,
      body: "answer",
    });

    const result = await service.wait(request.messageId, "requester", 1);
    expect(result).toMatchObject({
      status: "replied",
      reply: { messageId: reply.messageId },
    });
    expect(requests.get(request.messageId)?.status).toBe("replied");
  });

  it("returns timeout without changing state", async () => {
    const { delivery, service, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });

    const result = await service.wait(request.messageId, "requester", 0.15);
    expect(result).toEqual({ status: "timeout" });
    expect(requests.get(request.messageId)?.status).toBe("open");
  });

  it("two waiters both receive the reply without claiming it", async () => {
    const { delivery, service } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });
    const reply = await service.reply({
      sessionId: "target",
      requestId: request.messageId,
      body: "answer",
    });

    const [first, second] = await Promise.all([
      service.wait(request.messageId, "requester", 1),
      service.wait(request.messageId, "requester", 1),
    ]);
    expect(first).toMatchObject({ status: "replied" });
    expect(second).toMatchObject({ status: "replied" });
    expect((first as { reply: { messageId: string } }).reply.messageId).toBe(
      reply.messageId,
    );
    expect((second as { reply: { messageId: string } }).reply.messageId).toBe(
      reply.messageId,
    );

    const inbox = await delivery.inbox({ sessionId: "requester", limit: 10 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.message.messageId).toBe(reply.messageId);
  });
});

describe("RequestService.cancel", () => {
  it("sender cancel wins and reply after cancel returns request_cancelled", async () => {
    const { delivery, service, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });

    expect(service.cancel("requester", request.messageId)).toBe(true);
    expect(service.cancel("requester", request.messageId)).toBe(false);
    expect(requests.get(request.messageId)).toMatchObject({
      status: "cancelled",
      closeReason: "sender_cancel",
    });
    await expect(
      service.reply({
        sessionId: "target",
        requestId: request.messageId,
        body: "late",
      }),
    ).rejects.toMatchObject({ code: "request_cancelled" });
  });

  it("non-sender cancel returns not_actor", async () => {
    const { delivery, service, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });

    expect(() => service.cancel("target", request.messageId)).toThrowError(
      expect.objectContaining({ code: "not_actor" }),
    );
    expect(requests.get(request.messageId)?.status).toBe("open");
  });
});

describe("DeliveryService.retry", () => {
  it("retries only stored/notify_failed without duplicating the message", async () => {
    const { delivery, messages } = setup({ notifyFails: true });
    const sent = await delivery.send({
      fromSession: "requester",
      toSession: "target",
      kind: "notify",
      body: "retry me",
    });
    expect(sent.status).toBe("notify_failed");

    const retried = await delivery.retry({
      sessionId: "requester",
      messageId: sent.messageId,
    });
    expect(retried).toMatchObject({
      retried: true,
      messageId: sent.messageId,
      status: "notify_failed",
    });
    expect(messages.listForSession("target")).toHaveLength(1);

    await expect(
      delivery.retry({ sessionId: "other", messageId: sent.messageId }),
    ).rejects.toMatchObject({ code: "not_actor" });
  });

  it("does not retry an already notified message", async () => {
    const { delivery } = setup();
    const sent = await delivery.send({
      fromSession: "requester",
      toSession: "target",
      kind: "notify",
      body: "already sent",
    });
    expect(sent.status).toBe("notified");

    const retried = await delivery.retry({
      sessionId: "requester",
      messageId: sent.messageId,
    });
    expect(retried).toMatchObject({ retried: false, status: "notified" });
  });
});
