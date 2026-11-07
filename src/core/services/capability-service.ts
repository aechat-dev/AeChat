import { AechatError } from "../errors.js";
import type { SessionRepository, TransportBindingRepository } from "../store/sessions.js";
import type { TransportBindingRecord, SessionRecord } from "../types.js";
import type {
  CapabilityEvidence,
  TransportAdapter,
  TransportBinding,
} from "../transport/adapter.js";
import type { BoundState, SessionStatus } from "./session-status.js";
import type { ProbeRecord, ProbeRepository } from "../store/probes.js";

export interface CapabilitySet {
  pull: boolean;
  wait: boolean;
  notification_receive: boolean;
  busy_receive: boolean;
  idle_wakeup: boolean;
}

export interface CapabilityReport {
  supported: CapabilitySet;
  available: CapabilitySet;
  wakeup_level: "L0" | "L1" | "L2" | "L3" | "unknown";
  observed_at: string | null;
  conditions: string[];
  client_version: string | null;
}

export interface CapabilityInput {
  session: SessionRecord;
  binding: TransportBindingRecord | null;
  status: SessionStatus;
  boundState: BoundState;
  probe?: ProbeRecord | undefined;
}

export interface CapabilityServiceDeps {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  probes: ProbeRepository;
  transport: TransportAdapter;
}

function parseEvidence(json: string | null): Record<string, unknown> {
  if (json === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function adapterBinding(record: TransportBindingRecord): TransportBinding {
  return {
    transport: record.transport,
    address: record.address,
    team: record.team,
    mode: record.mode,
    state: record.state,
    evidence: parseEvidence(record.evidenceJson),
    bindDirective: "",
  };
}

function levelOf(probe: ProbeRecord | undefined): CapabilityReport["wakeup_level"] {
  const level = probe?.observedLevel;
  return level === "L0" || level === "L1" || level === "L2" || level === "L3"
    ? level
    : "unknown";
}

/**
 * Capability reporting is split in two:
 * supported is what the transport/client/probe can do; available is supported
 * AND the session being online and validly bound. available is always derived
 * at read time, never copied from a probe snapshot.
 */
export class CapabilityService {
  private readonly sessions: SessionRepository;
  private readonly bindings: TransportBindingRepository;
  private readonly probes: ProbeRepository;
  private readonly transport: TransportAdapter;

  constructor(deps: CapabilityServiceDeps) {
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.probes = deps.probes;
    this.transport = deps.transport;
  }

  async probe(sessionId: string): Promise<ProbeRecord> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError("session_not_found", `session not found: ${sessionId}`);
    }
    const binding = this.bindings.listForSession(sessionId).at(-1);
    if (binding === undefined) {
      throw new AechatError(
        "transport_unavailable",
        `session has no transport binding: ${sessionId}`,
      );
    }

    const evidence: CapabilityEvidence = await this.transport.probe(
      adapterBinding(binding),
    );
    return this.probes.insert({
      sessionId,
      client: session.client,
      clientVersion:
        typeof evidence.evidence["clientVersion"] === "string"
          ? evidence.evidence["clientVersion"]
          : null,
      observedLevel: evidence.observedLevel,
      busyReceive: evidence.busyReceive,
      idleWakeup: evidence.idleWakeup,
      evidenceJson: JSON.stringify(evidence.evidence),
      observedAt: evidence.at,
    });
  }

  report(input: CapabilityInput): CapabilityReport {
    const { binding, status, boundState, probe } = input;
    const hasBinding = binding !== null;
    const mode = binding?.mode;
    const supported: CapabilitySet = {
      pull: true,
      wait: true,
      notification_receive: hasBinding,
      busy_receive: probe?.busyReceive === true,
      idle_wakeup: probe?.idleWakeup === true,
    };

    const online = status === "online" && boundState === "valid" && hasBinding;
    const notificationAvailable =
      supported.notification_receive && mode !== "off" && mode !== "unknown";
    const available: CapabilitySet = online
      ? {
          pull: supported.pull,
          wait: supported.wait,
          notification_receive: notificationAvailable,
          busy_receive: notificationAvailable && supported.busy_receive,
          idle_wakeup: notificationAvailable && supported.idle_wakeup,
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
      wakeup_level: levelOf(probe),
      observed_at: probe?.observedAt ?? null,
      conditions: [],
      client_version: probe?.clientVersion ?? null,
    };
  }

  reportForSession(
    session: SessionRecord,
    binding: TransportBindingRecord | null,
    status: SessionStatus,
    boundState: BoundState,
  ): CapabilityReport {
    return this.report({
      session,
      binding,
      status,
      boundState,
      probe: this.probes.latestForSession(session.sessionId),
    });
  }
}
