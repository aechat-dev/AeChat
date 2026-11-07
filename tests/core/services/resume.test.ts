import { afterEach, describe, expect, it } from "vitest";

import { DeliveryRepository, MessageRepository } from "../../../src/core/store/messages.js";
import { ResumeService } from "../../../src/core/services/resume-service.js";
import { openDatabase } from "../../../src/core/store/db.js";
import { EventRepository } from "../../../src/core/store/events.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../../src/core/transport/fake.js";

const databases: Array<{ close(): void }> = [];

function setup(options: ConstructorParameters<typeof FakeTransportAdapter>[0] = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter({ live: false, ...options });
  const resume = new ResumeService({
    db,
    sessions,
    bindings,
    deliveries,
    transport,
    events,
    now: () => "2026-11-07T00:00:00.000Z",
  });

  sessions.create({
    sessionId: "old-session",
    displayName: "old",
    client: "claude-code",
    project: "/tmp/old",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-11-06T00:00:00.000Z",
  });
  const binding = bindings.create({
    bindingId: "old-binding",
    sessionId: "old-session",
    transport: "fake",
    address: "aechat-old",
    mode: "test",
    state: "bound",
    evidenceJson: JSON.stringify({ bindDirective: "fake actas aechat-old" }),
  });

  return { db, sessions, bindings, messages, deliveries, transport, resume, binding };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("ResumeService.begin", () => {
  it("rejects a live old host", async () => {
    const { resume } = setup({ live: true });

    await expect(resume.begin({ sessionId: "old-session" })).rejects.toMatchObject({
      code: "resume_unsafe",
    });
  });

  it("marks resume_pending for a dead host and returns the bind directive", async () => {
    const { resume, sessions, binding } = setup();

    const result = await resume.begin({ sessionId: "old-session" });

    expect(result.bindDirective).toBe("fake actas aechat-old");
    expect(result.forced).toBe(false);
    expect(sessions.get("old-session")?.resumeState).toBe("resume_pending");
    expect(binding.state).toBe("bound");
  });

  it("allows exactly one concurrent begin", async () => {
    const { resume } = setup();

    const results = await Promise.allSettled([
      resume.begin({ sessionId: "old-session" }),
      resume.begin({ sessionId: "old-session" }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "resume_conflict",
    });
  });
});

describe("ResumeService.confirm", () => {
  it("rolls back pending state when the new bind fails", async () => {
    const { resume, sessions, bindings } = setup({ bindMode: "fail" });
    await resume.begin({ sessionId: "old-session" });

    await expect(resume.confirm("old-session")).rejects.toMatchObject({
      code: "resume_unsafe",
    });
    expect(sessions.get("old-session")?.resumeState).toBe("idle");
    expect(bindings.getById("old-binding")?.state).toBe("bound");
  });

  it("finishes resume and resets delivered-but-unacked rows to notified", async () => {
    const { resume, sessions, bindings, messages, deliveries } = setup();
    messages.insert({
      messageId: "unacked-message",
      kind: "notify",
      fromSession: "old-session",
      toSession: "old-session",
      body: "hello",
      createdAt: "2026-11-06T00:00:00.000Z",
    });
    deliveries.insert({
      deliveryId: "unacked-delivery",
      messageId: "unacked-message",
      sessionId: "old-session",
      status: "delivered",
      deliveryToken: "old-token",
      leaseExpiresAt: "2026-11-06T00:00:00.000Z",
      attempts: 1,
    });
    await resume.begin({ sessionId: "old-session" });

    const session = await resume.confirm("old-session");

    expect(session.resumeState).toBe("idle");
    expect(session.resumeCount).toBe(1);
    expect(bindings.getById("old-binding")?.state).toBe("bound");
    expect(deliveries.get("unacked-delivery")).toMatchObject({
      status: "notified",
      deliveryToken: null,
      leaseExpiresAt: null,
    });
  });
});
