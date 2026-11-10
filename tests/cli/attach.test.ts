import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachCommand, hookSessionId } from "../../src/cli/commands/attach.js";
import type { CommandContext } from "../../src/cli/commands/context.js";
import type {
  AttachResult,
  ClaimResult,
} from "../../src/core/services/session-service.js";
import type {
  SessionRecord,
  TransportBindingRecord,
} from "../../src/core/types.js";

const session: SessionRecord = {
  sessionId: "s1",
  displayName: "codex-thread-1",
  client: "codex",
  project: "/tmp/project",
  conversationId: "thread-1",
  boundScope: "host_role",
  boundAt: "2026-11-09T00:00:00.000Z",
  boundCheckedAt: "2026-11-09T00:00:00.000Z",
  capabilitiesJson: null,
  lastSeenAt: "2026-11-09T00:00:00.000Z",
  hostSeenAt: null,
  hostSeenSource: null,
  resumeState: "idle",
  resumeCount: 0,
  resumedAt: null,
  createdAt: "2026-11-09T00:00:00.000Z",
  leftAt: null,
};

const binding: TransportBindingRecord = {
  bindingId: "b1",
  sessionId: "s1",
  transport: "agmsg",
  address: "aechat-test",
  team: null,
  mode: "agmsgd",
  state: "pending",
  boundAt: null,
  lastVerifiedAt: null,
  evidenceJson: JSON.stringify({ bindDirective: "aechat bind --session s1" }),
};

function result(claim: Partial<ClaimResult>): AttachResult {
  return {
    session,
    binding,
    attached: "existing",
    claim: {
      claimed: false,
      boundScope: "none",
      transportClaimState: "not-attempted",
      bindingState: "pending",
      session,
      ...claim,
    },
  };
}

function ctxWith(attach: AttachResult): CommandContext {
  return {
    service: { attach: vi.fn(async () => attach) },
  } as unknown as CommandContext;
}

let saved: string | undefined;

beforeEach(() => {
  saved = process.env["CODEX_THREAD_ID"];
  process.env["CODEX_THREAD_ID"] = "thread-1";
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env["CODEX_THREAD_ID"];
  } else {
    process.env["CODEX_THREAD_ID"] = saved;
  }
});

describe("aechat attach", () => {
  it("does not ask for a bind directive when the claim was accepted", async () => {
    const out = await attachCommand(
      ["--client", "codex"],
      ctxWith(
        result({
          claimed: true,
          boundScope: "host_role",
          transportClaimState: "accepted",
          bindingState: "bound",
        }),
      ),
    );

    expect(out).toMatchObject({
      bound_scope: "host_role",
      bound_state: "valid",
      binding_state: "bound",
      bind_directive: null,
    });
  });

  it("suppresses the bind directive when the claim outcome is unknown", async () => {
    const out = await attachCommand(
      ["--client", "codex"],
      ctxWith(
        result({
          transportClaimState: "unknown",
          reason: "outcome is unknown",
        }),
      ),
    );

    expect(out["bind_directive"]).toBeNull();
    expect(out["auto_bind"]).toMatchObject({
      transportClaimState: "unknown",
      bindingState: "pending",
      reason: "outcome is unknown",
    });
  });

  it("returns the bind directive when the claim was refused", async () => {
    const out = await attachCommand(
      ["--client", "codex"],
      ctxWith(
        result({
          transportClaimState: "refused",
          bindingState: "pending",
          reason: "held elsewhere",
        }),
      ),
    );

    expect(out).toMatchObject({
      bound_scope: "none",
      bound_state: "invalid",
      binding_state: "pending",
      bind_directive: "aechat bind --session s1",
    });
  });

  it("surfaces claim warnings", async () => {
    const out = await attachCommand(
      ["--client", "codex"],
      ctxWith(
        result({
          claimed: true,
          boundScope: "host_role",
          transportClaimState: "accepted",
          bindingState: "bound",
          warnings: ["codex seat was not recorded"],
        }),
      ),
    );

    expect(out["auto_bind"]).toMatchObject({
      warnings: ["codex seat was not recorded"],
    });
  });

  it("requires a declared host with a host session id", async () => {
    await expect(
      attachCommand(["--client", "codex"], ctxWith(result({}))),
    ).resolves.toBeDefined();
    await expect(
      attachCommand(["--client", "unknown-host"], ctxWith(result({}))),
    ).rejects.toThrow("declared host client");
    delete process.env["CODEX_THREAD_ID"];
    await expect(
      attachCommand(["--client", "codex"], ctxWith(result({}))),
    ).rejects.toThrow("no host session id");
  });
});

describe("hookSessionId", () => {
  it("reads session_id from a Codex hook payload", () => {
    expect(
      hookSessionId(
        JSON.stringify({
          session_id: "01a1aeb5-55d4-79c3-bfa7-e1d96c4fd2e5",
          cwd: "/tmp",
        }),
      ),
    ).toBe("01a1aeb5-55d4-79c3-bfa7-e1d96c4fd2e5");
  });

  it("ignores malformed or empty payloads", () => {
    expect(hookSessionId("not json")).toBeUndefined();
    expect(hookSessionId("{}")).toBeUndefined();
    expect(hookSessionId('{"session_id":""}')).toBeUndefined();
  });
});
