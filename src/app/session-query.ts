import type { SessionView } from "../contracts/ui.js";
import type { CapabilityService } from "../core/services/capability-service.js";
import { adapterBinding } from "../core/services/capability-service.js";
import type { SessionListEntry } from "../core/services/session-service.js";
import {
  DEFAULT_TTL,
  deriveBoundState,
  deriveStatus,
} from "../core/services/session-status.js";
import type {
  SessionRepository,
  TransportBindingRepository,
} from "../core/store/sessions.js";
import type { TransportAdapter } from "../core/transport/adapter.js";
import type { TransportState } from "../core/types.js";

export interface CapabilityQuery {
  reportForSession(
    session: SessionListEntry,
    binding: Parameters<CapabilityService["reportForSession"]>[1],
    status: Parameters<CapabilityService["reportForSession"]>[2],
    boundState: Parameters<CapabilityService["reportForSession"]>[3],
  ): ReturnType<CapabilityService["reportForSession"]>;
}

export interface SessionQueryDeps {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  transport: TransportAdapter;
  capabilities: CapabilityQuery;
  now: () => string;
}

/**
 * Single source for the session status/binding/capability view. The CLI list
 * command and the read-only UI snapshot both consume this, so they cannot
 * drift apart.
 */
export class SessionQueryService {
  private readonly sessions: SessionRepository;
  private readonly bindings: TransportBindingRepository;
  private readonly transport: TransportAdapter;
  private readonly capabilities: CapabilityQuery;
  private readonly now: () => string;

  constructor(deps: SessionQueryDeps) {
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.transport = deps.transport;
    this.capabilities = deps.capabilities;
    this.now = deps.now;
  }

  list(opts: { includeLeft?: boolean } = {}): Promise<SessionView[]> {
    const entries: SessionListEntry[] = this.sessions
      .list(opts)
      .map((session) => ({
        ...session,
        transport:
          this.bindings.listForSession(session.sessionId).at(-1) ?? null,
      }));
    return Promise.all(entries.map((entry) => this.view(entry)));
  }

  private async view(entry: SessionListEntry): Promise<SessionView> {
    const binding = entry.transport;
    let transportState: "live" | "dead" | "released" | "unknown" = "unknown";
    let inspectedAt: string | null = null;
    if (binding !== null) {
      try {
        const inspected = await this.transport.inspect(adapterBinding(binding));
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
      now: this.now(),
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
      now: this.now(),
      boundTtlSeconds: DEFAULT_TTL.boundTtlSeconds,
    });

    return {
      session_id: entry.sessionId,
      display_name: entry.displayName,
      client: entry.client,
      project: entry.project,
      conversation_id: entry.conversationId,
      status: status.status,
      status_evidence: status.evidence,
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
      capabilities: this.capabilities.reportForSession(
        entry,
        binding,
        status.status,
        boundState,
      ),
    };
  }
}
