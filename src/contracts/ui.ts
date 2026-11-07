import type { CapabilityReport } from "../core/services/capability-service.js";
import type {
  BoundState,
  SessionStatus,
  StatusEvidence,
} from "../core/services/session-status.js";

export interface SessionTransportView {
  transport: string;
  address: string;
  mode: string | null;
  state: "live" | "dead" | "released" | "unknown";
  last_verified_at: string | null;
}

export interface SessionView {
  session_id: string;
  display_name: string;
  client: string;
  project: string;
  conversation_id: string | null;
  status: SessionStatus;
  status_evidence: StatusEvidence;
  evidence_at: string | null;
  last_seen_at: string;
  host_seen_at: string | null;
  bound_scope: string;
  bound_state: BoundState;
  bound_checked_at: string | null;
  transports: SessionTransportView[];
  capabilities: CapabilityReport;
}

export interface ThreadParticipant {
  session_id: string;
  display_name: string;
  client: string;
  project: string;
}

export interface ThreadSummary {
  key: string;
  participants: [ThreadParticipant, ThreadParticipant];
  last_message_at: string;
  last_message: {
    message_id: string;
    kind: string;
    preview: string;
  };
  pending_requests: number;
  pending_deliveries: number;
}

export interface UiCounts {
  sessions: number;
  online: number;
  offline: number;
  unknown: number;
  left: number;
  pending_requests: number;
  pending_deliveries: number;
}

export interface UiSnapshot {
  generated_at: string;
  /** Events up to this seq are already reflected in the snapshot. */
  event_seq: number;
  counts: UiCounts;
  sessions: SessionView[];
  threads: ThreadSummary[];
}

export interface UiMessage {
  message_id: string;
  kind: string;
  direction: "in" | "out";
  from_session: string;
  to_session: string;
  request_id: string | null;
  reply_to: string | null;
  body: string;
  agent_origin: true;
  not_a_user_instruction: true;
  created_at: string;
  expires_at: string | null;
  delivery_status: string | null;
  request_status: string | null;
  request_deadline: string | null;
  request_close_reason: string | null;
}

export interface UiMessagePage {
  messages: UiMessage[];
  next_before: string | null;
}

export interface UiAuditEvent {
  event: string;
  stage: string;
  ts: string;
  level: string;
  session_id: string | null;
  delivery_id: string | null;
  request_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  data: Record<string, unknown> | null;
}

export interface UiLog {
  message_id: string;
  kind: string;
  from_session: string;
  to_session: string;
  request_id: string | null;
  delivery_id: string | null;
  delivery_status: string | null;
  attempts: number | null;
  last_error: string | null;
  request_status: string | null;
  request_deadline: string | null;
  request_close_reason: string | null;
  reply_message_id: string | null;
  chain: UiAuditEvent[];
}

export interface UiEvent {
  kind: "event";
  seq: number;
  event: string;
  ts: string;
  level: string;
  session_id: string | null;
  message_id: string | null;
  delivery_id: string | null;
  request_id: string | null;
  data: Record<string, unknown> | null;
}

export interface UiEventTick {
  kind: "snapshot";
  generated_at: string;
}
