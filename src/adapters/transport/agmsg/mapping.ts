import { randomBytes } from "node:crypto";

export interface TeamJson {
  agents?: Record<string, unknown>;
  [key: string]: unknown;
}

export const ADDRESS_PATTERN = /^aechat-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseAgmsgVersion(stdout: string): string | null {
  // version.sh prints a bare semver; the CLI prints "agmsg 1.7.1 (install: ...)".
  const match = /(\d+\.\d+\.\d+)/.exec(stdout);
  return match?.[1] ?? null;
}

export function generateAddress(): string {
  return `aechat-${randomBytes(6).toString("hex")}`;
}

export type LockState = "alive" | "stale" | "unknown" | "none";

export function parseLockState(raw: string | undefined): LockState {
  if (raw === undefined || raw === "none") {
    return "none";
  }
  if (raw === "empty" || raw === "unreadable") {
    return "unknown";
  }
  if (raw.startsWith("owner(alive)")) {
    return "alive";
  }
  if (raw.startsWith("owner(STALE)")) {
    return "stale";
  }
  if (raw.startsWith("owner(unknown)")) {
    return "unknown";
  }
  return "unknown";
}

export function hasAddress(team: TeamJson, address: string): boolean {
  // `team.sh <team> --json` prints an array of member rows; config.json uses
  // an `agents` object. Accept both shapes without leaking either into core.
  if (Array.isArray(team)) {
    return team.some((row) => isRecord(row) && row["member"] === address);
  }
  const agents = team.agents;
  return isRecord(agents) && Object.hasOwn(agents, address);
}

export function bindDirectiveFor(client: string, address: string): string {
  return client === "codex"
    ? `$agmsg actas ${address}`
    : `/agmsg actas ${address}`;
}
