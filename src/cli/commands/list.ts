import type { SessionListEntry } from "../../core/services/session-service.js";
import {
  DEFAULT_TTL,
  deriveBoundState,
  deriveStatus,
  type BoundState,
  type SessionStatus,
  type StatusEvidence,
} from "../../core/services/session-status.js";
import type { TransportBinding } from "../../core/transport/adapter.js";
import type { TransportBindingRecord } from "../../core/types.js";
import { parseArgs } from "../args.js";
import type { CommandContext } from "./context.js";

function adapterBinding(record: TransportBindingRecord): TransportBinding {
  let evidence: Record<string, unknown> = {};
  if (record.evidenceJson !== null) {
    try {
      const parsed: unknown = JSON.parse(record.evidenceJson);
      if (typeof parsed === "object" && parsed !== null) {
        evidence = parsed as Record<string, unknown>;
      }
    } catch {
      evidence = {};
    }
  }
  return {
    transport: record.transport,
    address: record.address,
    team: record.team,
    mode: record.mode,
    state: record.state,
    evidence,
    bindDirective: "",
  };
}

interface CapabilitySet {
  pull: boolean;
  wait: boolean;
  notification_receive: boolean;
  busy_receive: boolean;
  idle_wakeup: boolean;
}

function capabilitiesFor(
  entry: SessionListEntry,
  status: SessionStatus,
  boundState: BoundState,
): Record<string, unknown> {
  const hasBinding = entry.transport !== null;
  const supported: CapabilitySet = {
    pull: true,
    wait: true,
    notification_receive: hasBinding,
    busy_receive: false,
    idle_wakeup: false,
  };
  const mode = entry.transport?.mode;
  const canDeliver =
    status === "online" &&
    boundState === "valid" &&
    hasBinding &&
    mode !== "off" &&
    mode !== "unknown";
  const available: CapabilitySet = canDeliver
    ? {
        pull: true,
        wait: true,
        notification_receive: supported.notification_receive,
        busy_receive: false,
        idle_wakeup: false,
      }
    : {
        pull: false,
        wait: false,
        notification_receive: false,
        busy_receive: false,
        idle_wakeup: false,
      };

  return {
    supported,
    available,
    wakeup_level: "unknown",
    observed_at: null,
    conditions: [],
    client_version: null,
  };
}

export async function listCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const includeLeft = args.flags.has("all");
  const entries = ctx.service.list({ includeLeft });

  const sessions = await Promise.all(
    entries.map(async (entry) => {
      const binding = entry.transport;
      let transportState: "live" | "dead" | "released" | "unknown" = "unknown";
      let inspectedAt: string | null = null;
      if (binding !== null) {
        try {
          const inspected = await ctx.transport.inspect(adapterBinding(binding));
          transportState = inspected.state;
          inspectedAt = inspected.at ?? null;
        } catch {
          transportState = "unknown";
        }
      }

      const status = deriveStatus({
        lastSeenAt: entry.lastSeenAt,
        hostSeenAt: entry.hostSeenAt,
        binding: { state: transportState, at: inspectedAt },
        leftAt: entry.leftAt,
        now: ctx.now(),
        ttl: DEFAULT_TTL,
      });
      const boundState = deriveBoundState({
        boundScope: entry.boundScope,
        boundCheckedAt: entry.boundCheckedAt,
        binding,
        now: ctx.now(),
        boundTtlSeconds: DEFAULT_TTL.boundTtlSeconds,
      });

      return {
        session_id: entry.sessionId,
        display_name: entry.displayName,
        client: entry.client,
        project: entry.project,
        conversation_id: entry.conversationId,
        status: status.status satisfies SessionStatus,
        status_evidence: status.evidence satisfies StatusEvidence,
        evidence_at: status.evidenceAt,
        last_seen_at: entry.lastSeenAt,
        host_seen_at: entry.hostSeenAt,
        bound_scope: entry.boundScope,
        bound_state: boundState,
        bound_checked_at: entry.boundCheckedAt,
        transports:
          binding === null
            ? []
            : [
                {
                  transport: binding.transport,
                  address: binding.address,
                  mode: binding.mode,
                  state: transportState,
                  last_verified_at: binding.lastVerifiedAt,
                },
              ],
        capabilities: capabilitiesFor(entry, status.status, boundState),
      };
    }),
  );

  return { sessions };
}
