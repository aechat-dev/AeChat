import { afterEach, describe, expect, it, vi } from "vitest";

import { DeliveryService } from "../../../src/core/services/delivery-service.js";
import { ResumeService } from "../../../src/core/services/resume-service.js";
import { SessionService } from "../../../src/core/services/session-service.js";
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
  const now = () => "2026-11-07T00:00:00.000Z";
  const service = new SessionService({
    sessions,
    bindings,
    transport,
    requests,
    db,
    events,
    now,
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
    now,
  });
  const resume = new ResumeService({
    db,
    sessions,
    bindings,
    deliveries,
    transport,
    events,
    now,
  });

  for (const [sessionId, name] of [
    ["a", "a"],
    ["b", "b"],
    ["c", "c"],
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

  return {
    service,
    delivery,
    resume,
    transport,
    sessions,
    bindings,
    requests,
    messages,
    events,
  };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("SessionService.leave", () => {
  it("records cancel events for open requests and leave in the same chain", async () => {
    const { service, delivery, events } = setup();
    const request = await delivery.sendRequest({
      fromSession: "a",
      toSession: "b",
      body: "pending",
      deadlineSeconds: 300,
    });

    await service.leave("b");

    const cancel = events
      .listForMessage(request.messageId)
      .find((event) => event.event === "cancel");
    expect(cancel).toMatchObject({
      messageId: request.messageId,
      requestId: request.messageId,
    });
    expect(JSON.parse(cancel?.dataJson ?? "{}")).toMatchObject({
      closeReason: "target_left",
    });
    expect(events.listForSession("b").map((event) => event.event)).toContain(
      "leave",
    );
  });

  it("releases the binding and marks the session left", async () => {
    const { service, delivery, transport, sessions, bindings, messages } =
      setup();
    const sent = await delivery.send({
      fromSession: "a",
      toSession: "b",
      kind: "notify",
      body: "keep me",
    });
    vi.spyOn(transport, "release");

    await service.leave("b");

    expect(transport.release).toHaveBeenCalledOnce();
    expect(sessions.get("b")?.leftAt).not.toBeNull();
    expect(bindings.getById("binding-b")?.state).toBe("released");
    expect(messages.get(sent.messageId)?.body).toBe("keep me");
  });

  it("does not change state when transport release fails", async () => {
    const { service, transport, sessions, bindings } = setup();
    vi.spyOn(transport, "release").mockRejectedValueOnce(
      new Error("release failed"),
    );

    await expect(service.leave("b")).rejects.toMatchObject({
      code: "transport_unavailable",
    });
    expect(sessions.get("b")?.leftAt).toBeNull();
    expect(bindings.getById("binding-b")?.state).toBe("bound");
  });

  it("cancels open requests with target/requester left reasons", async () => {
    const { service, delivery, requests } = setup();
    const targetRequest = await delivery.sendRequest({
      fromSession: "a",
      toSession: "b",
      body: "to b",
    });
    const requesterRequest = await delivery.sendRequest({
      fromSession: "a",
      toSession: "c",
      body: "from a",
    });

    await service.leave("b");
    await service.leave("a");

    expect(requests.get(targetRequest.messageId)).toMatchObject({
      status: "cancelled",
      closeReason: "target_left",
    });
    expect(requests.get(requesterRequest.messageId)).toMatchObject({
      status: "cancelled",
      closeReason: "requester_left",
    });
  });

  it("makes send and resume reject the left session", async () => {
    const { service, delivery, resume } = setup();
    await service.leave("b");

    await expect(
      delivery.send({
        fromSession: "a",
        toSession: "b",
        kind: "notify",
        body: "after leave",
      }),
    ).rejects.toMatchObject({ code: "target_left" });
    await expect(resume.begin({ sessionId: "b" })).rejects.toMatchObject({
      code: "resume_unsafe",
    });
  });

  it("rejects ordinary confirm after leave and keeps the binding released", async () => {
    const { service, bindings } = setup();
    await service.leave("b");

    await expect(service.confirm("b")).rejects.toMatchObject({
      code: "resume_unsafe",
    });
    expect(bindings.getById("binding-b")?.state).toBe("released");
  });
});
