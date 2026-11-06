import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
  type CreateSessionInput,
} from "../../../src/core/store/sessions.js";

const databases: Array<{ close(): void }> = [];

function setup(): {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
} {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  return {
    sessions: new SessionRepository(db),
    bindings: new TransportBindingRepository(db),
  };
}

function sessionInput(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    sessionId: "session-1",
    displayName: "dev",
    client: "claude-code",
    project: "/tmp/project",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("SessionRepository", () => {
  it("creates two sessions with the same display_name", () => {
    const { sessions } = setup();
    sessions.create(sessionInput({ sessionId: "session-1" }));
    sessions.create(sessionInput({ sessionId: "session-2" }));

    const matches = sessions.findByDisplayName("dev");
    expect(matches.map((session) => session.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("rejects duplicate (transport,address) bindings", () => {
    const { sessions, bindings } = setup();
    sessions.create(sessionInput({ sessionId: "session-1" }));
    sessions.create(sessionInput({ sessionId: "session-2", displayName: "other" }));

    bindings.create({
      bindingId: "binding-1",
      sessionId: "session-1",
      transport: "agmsg",
      address: "aechat-aaaaaaaaaaaa",
      state: "pending",
    });

    expect(() =>
      bindings.create({
        bindingId: "binding-2",
        sessionId: "session-2",
        transport: "agmsg",
        address: "aechat-aaaaaaaaaaaa",
        state: "pending",
      }),
    ).toThrow();
  });

  it("list excludes left unless includeLeft", () => {
    const { sessions } = setup();
    sessions.create(sessionInput({ sessionId: "session-1" }));
    sessions.create(sessionInput({ sessionId: "session-2", displayName: "other" }));
    sessions.markLeft("session-2", "2026-11-06T01:00:00.000Z");

    expect(sessions.list().map((session) => session.sessionId)).toEqual(["session-1"]);
    expect(sessions.list({ includeLeft: true })).toHaveLength(2);
  });

  it("touch updates last_seen_at and optionally host_seen_at", () => {
    const { sessions } = setup();
    sessions.create(sessionInput());

    sessions.touch("session-1", "2026-11-06T02:00:00.000Z");
    let session = sessions.get("session-1");
    expect(session?.lastSeenAt).toBe("2026-11-06T02:00:00.000Z");
    expect(session?.hostSeenAt).toBeNull();

    sessions.touch("session-1", "2026-11-06T03:00:00.000Z", { host: true });
    session = sessions.get("session-1");
    expect(session?.lastSeenAt).toBe("2026-11-06T03:00:00.000Z");
    expect(session?.hostSeenAt).toBe("2026-11-06T03:00:00.000Z");
  });

  it("finds sessions by conversation id and updates binding evidence", () => {
    const { sessions } = setup();
    sessions.create(sessionInput({ conversationId: "conv-1" }));

    expect(sessions.findByConversationId("conv-1")).toHaveLength(1);
    expect(sessions.findByConversationId("missing")).toHaveLength(0);

    expect(
      sessions.updateBinding({
        sessionId: "session-1",
        boundScope: "conversation",
        boundAt: "2026-11-06T04:00:00.000Z",
        boundCheckedAt: "2026-11-06T04:00:00.000Z",
        conversationId: "conv-1",
      }),
    ).toBe(true);
    expect(sessions.get("session-1")?.boundScope).toBe("conversation");
  });

  it("setResumeState reports whether the session exists", () => {
    const { sessions } = setup();
    sessions.create(sessionInput());

    expect(sessions.setResumeState("session-1", "resume_pending")).toBe(true);
    expect(sessions.get("session-1")?.resumeState).toBe("resume_pending");
    expect(sessions.setResumeState("missing", "resume_pending")).toBe(false);
  });
});
