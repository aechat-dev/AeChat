import type { SessionListEntry } from "../../core/services/session-service.js";
import {
  DEFAULT_TTL,
  deriveBoundState,
  deriveStatus,
  type SessionStatus,
  type StatusEvidence,
} from "../../core/services/session-status.js";
import { adapterBinding } from "../../core/services/capability-service.js";
import type { TransportState } from "../../core/types.js";
import { parseArgs } from "../args.js";
import type { CommandContext } from "./context.js";

export async function listCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const includeLeft = args.flags.has("all");
  ctx.audit.recordListRead(args.values.get("as"));
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
        hostSeenSource: entry.hostSeenSource,
        binding: { state: transportState, at: inspectedAt },
        leftAt: entry.leftAt,
        now: ctx.now(),
        ttl: DEFAULT_TTL,
      });
      let effectiveBindingState: TransportState = binding?.state ?? "pending";
      if (transportState === "live") {
        effectiveBindingState = "bound";
      } else if (transportState === "dead" || transportState === "released") {
        effectiveBindingState = "released";
      } else if (binding !== null && binding.state === "bound") {
        // The transport could not prove liveness; do not report a valid bind.
        effectiveBindingState = "stale";
      }
      const boundState = deriveBoundState({
        boundScope: entry.boundScope,
        boundCheckedAt: entry.boundCheckedAt,
        binding: binding === null ? null : { state: effectiveBindingState },
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
        capabilities: ctx.capabilities.reportForSession(
          entry,
          binding,
          status.status,
          boundState,
        ),
      };
    }),
  );

  return { sessions };
}
