import type { BoundScope, TransportState } from "../types.js";

export type SessionStatus = "online" | "unknown" | "offline" | "left";
export type BoundState = "valid" | "stale" | "invalid";
export type StatusEvidence =
  | "transport_live"
  | "heartbeat"
  | "hook"
  | "cli"
  | "transport_dead"
  | "none";

export interface TtlConfig {
  onlineTtlSeconds: number;
  unknownTtlSeconds: number;
  boundTtlSeconds: number;
}

export const DEFAULT_TTL: TtlConfig = {
  onlineTtlSeconds: 90,
  unknownTtlSeconds: 10 * 60,
  boundTtlSeconds: 10 * 60,
};

export interface StatusBinding {
  state: "live" | "dead" | "released" | "unknown";
  at?: string | null;
}

export interface DeriveStatusInput {
  lastSeenAt: string | null;
  hostSeenAt: string | null;
  hostSeenSource?: string | null;
  binding: StatusBinding | null;
  leftAt?: string | null;
  now: string;
  ttl: TtlConfig;
}

export interface StatusResult {
  status: SessionStatus;
  evidence: StatusEvidence;
  evidenceAt: string | null;
}

function ageSeconds(at: string | null, now: string): number | null {
  if (at === null) {
    return null;
  }
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) {
    return null;
  }
  return (nowMs - atMs) / 1000;
}

function latestTimestamp(at: string | null, host: string | null): string | null {
  if (at === null) {
    return host;
  }
  if (host === null) {
    return at;
  }
  return Date.parse(host) > Date.parse(at) ? host : at;
}

/**
 * Status is derived at read time, never persisted. A live transport binding is
 * sufficient on its own; otherwise recent CLI/host evidence is used, then
 * dead-transport or TTL evidence.
 */
export function deriveStatus(input: DeriveStatusInput): StatusResult {
  if (input.leftAt !== null && input.leftAt !== undefined) {
    return { status: "left", evidence: "none", evidenceAt: input.leftAt };
  }

  if (input.binding?.state === "live") {
    return {
      status: "online",
      evidence: "transport_live",
      evidenceAt: input.binding.at ?? input.now,
    };
  }

  const hostAge = ageSeconds(input.hostSeenAt, input.now);
  if (hostAge !== null && hostAge <= input.ttl.onlineTtlSeconds) {
    return {
      status: "online",
      evidence: input.hostSeenSource === "heartbeat" ? "heartbeat" : "hook",
      evidenceAt: input.hostSeenAt,
    };
  }

  const cliAge = ageSeconds(input.lastSeenAt, input.now);
  if (cliAge !== null && cliAge <= input.ttl.onlineTtlSeconds) {
    return { status: "online", evidence: "cli", evidenceAt: input.lastSeenAt };
  }

  if (
    input.binding !== null &&
    (input.binding.state === "dead" || input.binding.state === "released")
  ) {
    return {
      status: "offline",
      evidence: "transport_dead",
      evidenceAt: input.binding.at ?? null,
    };
  }

  const latest = latestTimestamp(input.lastSeenAt, input.hostSeenAt);
  const latestAge = ageSeconds(latest, input.now);
  if (latestAge !== null && latestAge > input.ttl.unknownTtlSeconds) {
    return { status: "offline", evidence: "none", evidenceAt: latest };
  }

  return { status: "unknown", evidence: "none", evidenceAt: latest };
}

export interface DeriveBoundStateInput {
  boundScope: BoundScope;
  boundCheckedAt: string | null;
  binding: { state: TransportState } | null;
  now: string;
  boundTtlSeconds: number;
}

export function deriveBoundState(input: DeriveBoundStateInput): BoundState {
  if (input.boundScope === "none") {
    return "invalid";
  }
  if (
    input.binding === null ||
    input.binding.state === "released" ||
    input.binding.state === "failed" ||
    input.binding.state === "pending"
  ) {
    return "invalid";
  }
  if (input.binding.state === "stale") {
    return "stale";
  }
  if (input.binding.state !== "bound") {
    return "invalid";
  }
  if (input.boundCheckedAt === null) {
    return "invalid";
  }
  const age = ageSeconds(input.boundCheckedAt, input.now);
  if (age === null || age > input.boundTtlSeconds) {
    return "stale";
  }
  return "valid";
}
