import { afterEach, describe, expect, it } from "vitest";

import { AechatError } from "../../../src/core/errors.js";
import { SessionService } from "../../../src/core/services/session-service.js";
import { openDatabase } from "../../../src/core/store/db.js";
import { EventRepository } from "../../../src/core/store/events.js";
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
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter(options);
  let tick = 0;
  const service = new SessionService({
    sessions,
    bindings,
    transport,
    events,
    now: () => `2026-11-06T00:00:0${tick++}.000Z`,
  });
  return { service, sessions, bindings, events, transport };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("SessionService.register", () => {
  it("creates a session and a pending binding", async () => {
    const { service, bindings } = setup();

    const result = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    expect(result.session.displayName).toBe("dev");
    expect(result.session.boundScope).toBe("none");
    expect(result.binding.state).toBe("pending");
    expect(result.binding.transport).toBe("fake");
    expect(result.bindDirective).toContain(result.binding.address);

    const stored = bindings.listForSession(result.session.sessionId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.state).toBe("pending");
  });

  it("rejects invalid display names before touching the transport", async () => {
    const { service } = setup();
    const invalid = [
      "",
      "a".repeat(65),
      "bad\nname",
      "01a1b131-2cc1-73d2-a6c3-8f3da444bd07",
      "[AeChat] dev",
    ];

    for (const displayName of invalid) {
      await expect(
        service.register({
          displayName,
          client: "claude-code",
          project: "/tmp/project",
        }),
      ).rejects.toMatchObject({ code: "invalid_name" });
    }
  });

  it("rejects invalid host ids before touching the transport", async () => {
    const { service, sessions } = setup();
    const invalid = ["", "Claude Code", "-lead", "a".repeat(33)];

    for (const client of invalid) {
      await expect(
        service.register({
          displayName: "dev",
          client,
          project: "/tmp/project",
        }),
      ).rejects.toMatchObject({ code: "invalid_name" });
    }
    expect(sessions.list()).toHaveLength(0);
  });

  it("does not persist a session when transport registration fails", async () => {
    const { service, sessions } = setup({ registerFails: true });

    await expect(
      service.register({
        displayName: "dev",
        client: "claude-code",
        project: "/tmp/project",
      }),
    ).rejects.toThrow("fake register failure");
    expect(sessions.list()).toHaveLength(0);
  });

  it("writes register and confirm audit events", async () => {
    const { service, events } = setup({ bindMode: "host_role" });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });
    await service.confirm(registered.session.sessionId);

    const names = events
      .listForSession(registered.session.sessionId)
      .map((event) => event.event);
    expect(names).toEqual(["register", "confirm"]);
  });

  it("stores a host id that core does not declare", async () => {
    const { service } = setup();

    const result = await service.register({
      displayName: "third",
      client: "third-host",
      project: "/tmp/project",
    });

    expect(result.session.client).toBe("third-host");
    expect(service.whoami({ sessionId: result.session.sessionId }).client).toBe(
      "third-host",
    );
  });

  it("allows duplicate display names", async () => {
    const { service } = setup();
    const input = {
      displayName: "dev",
      client: "claude-code" as const,
      project: "/tmp/project",
    };

    const first = await service.register(input);
    const second = await service.register(input);

    expect(first.session.sessionId).not.toBe(second.session.sessionId);
    expect(first.binding.address).not.toBe(second.binding.address);
  });
});

describe("SessionService.confirm", () => {
  it("sets bound_scope=conversation when conversation id matches", async () => {
    const { service } = setup({ bindMode: "conversation" });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
      conversationId: "conv-1",
    });

    const confirmed = await service.confirm(registered.session.sessionId);

    expect(confirmed.boundScope).toBe("conversation");
    expect(confirmed.session.conversationId).toBe("conv-1");
    expect(confirmed.session.boundScope).toBe("conversation");
    expect(confirmed.session.boundCheckedAt).not.toBeNull();
  });

  it("falls back to host_role when conversation id is unavailable", async () => {
    const { service } = setup({ bindMode: "conversation" });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    const confirmed = await service.confirm(registered.session.sessionId);

    expect(confirmed.boundScope).toBe("host_role");
    expect(confirmed.session.boundScope).toBe("host_role");
  });

  it("fails with session_not_found for an unknown session", async () => {
    const { service } = setup();

    await expect(service.confirm("missing")).rejects.toMatchObject({
      code: "session_not_found",
    });
  });
});

describe("SessionService.whoami", () => {
  it("finds a session by conversation id and rejects zero or multiple matches", async () => {
    const { service } = setup();
    const first = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
      conversationId: "conv-1",
    });

    const found = service.whoami({ conversationId: "conv-1" });
    expect(found.sessionId).toBe(first.session.sessionId);

    expect(() => service.whoami({ conversationId: "missing" })).toThrow(
      AechatError,
    );
    try {
      service.whoami({ conversationId: "missing" });
    } catch (error) {
      expect((error as AechatError).code).toBe("session_not_found");
    }

    await service.register({
      displayName: "other",
      client: "claude-code",
      project: "/tmp/project",
      conversationId: "conv-1",
    });
    expect(() => service.whoami({ conversationId: "conv-1" })).toThrow(
      AechatError,
    );
    try {
      service.whoami({ conversationId: "conv-1" });
    } catch (error) {
      expect((error as AechatError).code).toBe("ambiguous_target");
    }
  });

  it("finds a session by session id", async () => {
    const { service } = setup();
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    expect(
      service.whoami({ sessionId: registered.session.sessionId }).sessionId,
    ).toBe(registered.session.sessionId);
  });
});

describe("SessionService.list and heartbeat", () => {
  it("merges the transport binding into list results", async () => {
    const { service } = setup();
    await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    const [entry] = service.list();
    expect(entry?.transport?.transport).toBe("fake");
    expect(entry?.displayName).toBe("dev");
  });

  it("heartbeat updates host_seen_at", async () => {
    const { service, sessions } = setup();
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    service.heartbeat(registered.session.sessionId, "2026-11-06T05:00:00.000Z");
    expect(sessions.get(registered.session.sessionId)?.hostSeenAt).toBe(
      "2026-11-06T05:00:00.000Z",
    );
  });
});

describe("SessionService.claim", () => {
  it("claims from a host session and confirms host_role", async () => {
    const { service, transport } = setup();
    Object.assign(transport, {
      claim: async () => ({ ok: true }),
    });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    await expect(
      service.claim(registered.session.sessionId, "host-session-1"),
    ).resolves.toMatchObject({
      claimed: true,
      boundScope: "host_role",
      transportClaimState: "accepted",
      bindingState: "bound",
    });
  });

  it("does not call a claim successful without a live binding", async () => {
    const { service, transport } = setup({ bindMode: "none" });
    Object.assign(transport, {
      claim: async () => ({ ok: true }),
    });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    const result = await service.claim(
      registered.session.sessionId,
      "host-session-1",
    );

    expect(result).toMatchObject({
      claimed: false,
      boundScope: "none",
      transportClaimState: "accepted",
      bindingState: "failed",
    });
    expect(result.reason).toContain("no live binding");
  });

  it("reports a held role when confirmation throws after the claim", async () => {
    const { service, transport } = setup();
    Object.assign(transport, {
      claim: async () => ({ ok: true }),
      bind: async () => {
        throw new Error("bind verification failed");
      },
    });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    const result = await service.claim(
      registered.session.sessionId,
      "host-session-1",
    );

    expect(result).toMatchObject({
      claimed: false,
      boundScope: "none",
      transportClaimState: "accepted",
      bindingState: "pending",
    });
    expect(result.reason).toContain("binding verification failed");
    expect(result.reason).toContain("aechat confirm");
  });

  it("reports an unknown outcome when the claim command throws", async () => {
    const { service, transport } = setup();
    Object.assign(transport, {
      claim: async () => {
        throw new Error("claim command timed out after acquiring lock");
      },
    });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    const result = await service.claim(
      registered.session.sessionId,
      "host-session-1",
    );

    expect(result).toMatchObject({
      claimed: false,
      boundScope: "none",
      transportClaimState: "unknown",
      bindingState: "pending",
    });
    expect(result.reason).toContain("outcome is unknown");
    expect(result.reason).toContain("Do not run the bind directive");
  });

  it("keeps the binding unclaimed when the adapter refuses", async () => {
    const { service, transport } = setup();
    Object.assign(transport, {
      claim: async () => ({ ok: false, error: "held by another session" }),
    });
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    await expect(
      service.claim(registered.session.sessionId, "host-session-1"),
    ).resolves.toMatchObject({
      claimed: false,
      boundScope: "none",
      transportClaimState: "refused",
      bindingState: "pending",
      reason: "held by another session",
    });
  });

  it("reports transports without claim support", async () => {
    const { service } = setup();
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
    });

    await expect(
      service.claim(registered.session.sessionId, "host-session-1"),
    ).resolves.toMatchObject({
      claimed: false,
      boundScope: "none",
      transportClaimState: "not-attempted",
      bindingState: "pending",
      reason: "transport does not support host-session claims",
    });
  });
});
