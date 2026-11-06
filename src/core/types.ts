/**
 * Core persisted types. Transport-specific fields never appear here; adapters
 * write them through the generic `transport_bindings` shape.
 */
export type SessionId = string;
export type BindingId = string;
export type MessageId = string;
export type DeliveryId = string;
export type RequestId = string;

export type Client = "claude-code" | "codex" | "other";
export type BoundScope = "conversation" | "host_role" | "none";
export type ResumeState = "idle" | "resume_pending";
export type TransportState = "pending" | "bound" | "stale" | "released" | "failed";

export interface SessionRecord {
  sessionId: SessionId;
  displayName: string;
  client: Client;
  project: string;
  conversationId: string | null;
  boundScope: BoundScope;
  boundAt: string | null;
  boundCheckedAt: string | null;
  capabilitiesJson: string | null;
  lastSeenAt: string;
  hostSeenAt: string | null;
  resumeState: ResumeState;
  resumeCount: number;
  resumedAt: string | null;
  createdAt: string;
  leftAt: string | null;
}

export interface TransportBindingRecord {
  bindingId: BindingId;
  sessionId: SessionId;
  transport: string;
  address: string;
  team: string | null;
  mode: string | null;
  state: TransportState;
  boundAt: string | null;
  lastVerifiedAt: string | null;
  evidenceJson: string | null;
}
