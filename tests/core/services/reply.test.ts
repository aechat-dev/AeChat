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

describe("RequestService.reply", () => {
  it("marks the request replied and links the reply message", async () => {
    const { delivery, service, messages, deliveries, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
      deadlineSeconds: 60,
    });

    const reply = await service.reply({
      sessionId: "target",
      requestId: request.messageId,
      body: "answer",
    });

    expect(reply).toEqual({
      messageId: expect.any(String),
      alreadyReplied: false,
    });
    expect(requests.get(request.messageId)).toMatchObject({
      status: "replied",
      closeReason: "replied",
      replyMessageId: reply.messageId,
    });
    expect(messages.get(reply.messageId)).toMatchObject({
      kind: "reply",
      fromSession: "target",
      toSession: "requester",
      requestId: request.messageId,
      replyTo: request.messageId,
      body: "answer",
    });
    expect(
      deliveries.getForMessageSession(reply.messageId, "requester")?.status,
    ).toBe("notified");
    expect(
      deliveries.getForMessageSession(request.messageId, "target"),
    ).toMatchObject({ status: "acked" });
    expect(
      deliveries.getForMessageSession(request.messageId, "target")?.repliedAt,
    ).toBe("2026-11-07T00:00:00.000Z");

    const inbox = await delivery.inbox({ sessionId: "requester", limit: 10 });
    expect(inbox.map((item) => item.message.messageId)).toContain(reply.messageId);
  });

  it("reply after deadline returns request_expired without a prior read", async () => {
    const { delivery, service, messages, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
      deadlineSeconds: 60,
      now: "2026-11-07T00:00:00.000Z",
    });

    await expect(
      service.reply({
        sessionId: "target",
        requestId: request.messageId,
        body: "late",
        now: "2026-11-07T00:01:01.000Z",
      }),
    ).rejects.toMatchObject({ code: "request_expired" });

    expect(requests.get(request.messageId)).toMatchObject({
      status: "expired",
      closeReason: "deadline",
      replyMessageId: null,
    });
    expect(messages.listForSession("target")).toHaveLength(1);
  });

  it("duplicate reply returns the existing reply idempotently", async () => {
    const { delivery, service, messages, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });

    const first = await service.reply({
      sessionId: "target",
      requestId: request.messageId,
      body: "answer",
    });
    const second = await service.reply({
      sessionId: "target",
      requestId: request.messageId,
      body: "answer again",
    });

    expect(second).toEqual({ messageId: first.messageId, alreadyReplied: true });
    expect(messages.listForSession("target")).toHaveLength(2);
    expect(requests.get(request.messageId)?.replyMessageId).toBe(first.messageId);
  });

  it("non-target reply returns not_actor", async () => {
    const { delivery, service, requests } = setup();
    const request = await delivery.sendRequest({
      fromSession: "requester",
      toSession: "target",
      body: "please reply",
    });

    await expect(
      service.reply({
        sessionId: "requester",
        requestId: request.messageId,
        body: "self answer",
      }),
    ).rejects.toMatchObject({ code: "not_actor" });
    await expect(
      service.reply({
        sessionId: "other",
        requestId: request.messageId,
        body: "other answer",
      }),
    ).rejects.toMatchObject({ code: "not_actor" });
    expect(requests.get(request.messageId)?.status).toBe("open");
  });
});
