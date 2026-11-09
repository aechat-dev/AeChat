import type {
  BoundScope,
  Client,
  SessionId,
  TransportState,
} from "../types.js";

export interface SessionRef {
  sessionId: SessionId;
  displayName: string;
  client: Client;
  project: string;
  conversationId: string | null;
}

/**
 * Adapter-owned binding shape. Core persists this through
 * `transport_bindings`; no transport-specific fields leak into core types.
 */
export interface TransportBinding {
  transport: string;
  address: string;
  team: string | null;
  mode: string | null;
  state: TransportState;
  evidence: Record<string, unknown>;
  bindDirective: string;
}

export interface BindResult {
  state: TransportState;
  boundScope: BoundScope;
  conversationId: string | null;
  evidence: Record<string, unknown>;
  /** Current delivery mode, when the adapter can read it again. */
  mode?: string | null;
  reason?: string;
}

export interface PointerNotification {
  messageId: string;
  fromSession: SessionId;
  toSession: SessionId;
  /** Sender's transport address, when the adapter needs it for routing. */
  fromAddress?: string;
  /**
   * The durable message body. Adapters that can inject a host turn use it to
   * deliver the message directly instead of sending a pull pointer.
   */
  body?: string;
  /** Message kind, so a direct host delivery can carry reply metadata. */
  kind?: string;
  /** Sender display name for the direct-injection header. */
  fromName?: string;
  /** Target host conversation id, when the session recorded one. */
  conversationId?: string | null;
  /** Target host client and project, for adapters with direct host delivery. */
  targetClient?: string;
  targetProject?: string;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  /** Non-fatal follow-up the caller should surface to the agent. */
  warning?: string;
}

export interface TransportStatus {
  state: "live" | "dead" | "released" | "unknown";
  at?: string;
  evidence?: Record<string, unknown>;
}

export type ObservedLevel = "L0" | "L1" | "L2" | "L3" | "unknown";

export interface CapabilityEvidence {
  observedLevel: ObservedLevel;
  pull: boolean | null;
  wait: boolean | null;
  notificationReceive: boolean | null;
  busyReceive: boolean | null;
  idleWakeup: boolean | null;
  evidence: Record<string, unknown>;
  at: string;
}

/**
 * Stable adapter interface. Core depends only on this; official and
 * third-party adapters implement the same contract.
 */
export interface TransportAdapter {
  readonly name: string;
  register(
    session: SessionRef,
    desiredAddress?: string,
  ): Promise<TransportBinding>;
  bind(
    session: SessionRef,
    binding: TransportBinding,
    conversationId?: string,
  ): Promise<BindResult>;
  notify(
    binding: TransportBinding,
    notification: PointerNotification,
  ): Promise<NotifyResult>;
  /**
   * Claim the binding from inside the host conversation. Adapters that cannot
   * take a host session id omit this; register then returns a bind directive.
   */
  claim?(
    session: SessionRef,
    binding: TransportBinding,
    hostSessionId: string,
  ): Promise<NotifyResult>;
  inspect(binding: TransportBinding): Promise<TransportStatus>;
  release(binding: TransportBinding): Promise<void>;
  probe(binding: TransportBinding): Promise<CapabilityEvidence>;
}
