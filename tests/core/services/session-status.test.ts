import { describe, expect, it } from "vitest";

import {
  DEFAULT_TTL,
  deriveBoundState,
  deriveStatus,
} from "../../../src/core/services/session-status.js";

const NOW = "2026-11-06T12:00:00.000Z";

describe("deriveStatus", () => {
  it("is left when the session has an explicit left_at", () => {
    const result = deriveStatus({
      lastSeenAt: NOW,
      hostSeenAt: null,
      binding: { state: "live" },
      leftAt: "2026-11-06T11:00:00.000Z",
      now: NOW,
      ttl: DEFAULT_TTL,
    });
    expect(result).toEqual({
      status: "left",
      evidence: "none",
      evidenceAt: "2026-11-06T11:00:00.000Z",
    });
  });

  it("is online when transport inspect reports live even without recent CLI", () => {
    const result = deriveStatus({
      lastSeenAt: "2026-11-06T10:00:00.000Z",
      hostSeenAt: null,
      binding: { state: "live", at: NOW },
      now: NOW,
      ttl: DEFAULT_TTL,
    });

    expect(result).toEqual({
      status: "online",
      evidence: "transport_live",
      evidenceAt: NOW,
    });
  });

  it("is unknown after online_ttl and offline after unknown_ttl", () => {
    const unknown = deriveStatus({
      lastSeenAt: "2026-11-06T11:58:00.000Z",
      hostSeenAt: null,
      binding: { state: "unknown" },
      now: NOW,
      ttl: DEFAULT_TTL,
    });
    expect(unknown.status).toBe("unknown");

    const offline = deriveStatus({
      lastSeenAt: "2026-11-06T11:40:00.000Z",
      hostSeenAt: null,
      binding: { state: "dead" },
      now: NOW,
      ttl: DEFAULT_TTL,
    });
    expect(offline).toMatchObject({ status: "offline", evidence: "transport_dead" });
  });

  it("uses recent CLI evidence when transport is not live", () => {
    const result = deriveStatus({
      lastSeenAt: "2026-11-06T11:59:30.000Z",
      hostSeenAt: null,
      binding: { state: "unknown" },
      now: NOW,
      ttl: DEFAULT_TTL,
    });
    expect(result).toMatchObject({ status: "online", evidence: "cli" });
  });
});

describe("deriveBoundState", () => {
  it("becomes stale after bound_ttl", () => {
    const result = deriveBoundState({
      boundScope: "host_role",
      boundCheckedAt: "2026-11-06T11:00:00.000Z",
      binding: { state: "bound" },
      now: NOW,
      boundTtlSeconds: 600,
    });
    expect(result).toBe("stale");
  });

  it("is invalid when no binding or scope is none", () => {
    expect(
      deriveBoundState({
        boundScope: "host_role",
        boundCheckedAt: NOW,
        binding: null,
        now: NOW,
        boundTtlSeconds: 600,
      }),
    ).toBe("invalid");
    expect(
      deriveBoundState({
        boundScope: "none",
        boundCheckedAt: NOW,
        binding: { state: "bound" },
        now: NOW,
        boundTtlSeconds: 600,
      }),
    ).toBe("invalid");
  });

  it("does not treat a pending transport as a valid binding", () => {
    expect(
      deriveBoundState({
        boundScope: "host_role",
        boundCheckedAt: NOW,
        binding: { state: "pending" },
        now: NOW,
        boundTtlSeconds: 600,
      }),
    ).toBe("invalid");
  });
});
