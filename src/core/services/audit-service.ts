import { AechatError } from "../errors.js";
import { redactErrorDetail } from "../log-redaction.js";
import type { DeliveryRepository, MessageRepository } from "../store/messages.js";
import type { RequestRepository } from "../store/requests.js";
import type { EventRecord, EventRepository } from "../store/events.js";
import type { SessionRepository } from "../store/sessions.js";

export interface AuditLogInput {
  messageId: string;
  deliveryId?: string;
  asSession?: string;
}

export interface AuditChainEvent {
  event: string;
  stage: string;
  ts: string;
  level: string;
  sessionId: string | null;
  deliveryId: string | null;
  requestId: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  data: Record<string, unknown> | null;
}

export interface AuditLogEntry {
  messageId: string;
  kind: string;
  fromSession: string;
  toSession: string;
  requestId: string | null;
  deliveryId: string | null;
  deliveryStatus: string | null;
  attempts: number | null;
  lastError: string | null;
  requestStatus: string | null;
  replyMessageId: string | null;
  chain: AuditChainEvent[];
}

export interface HistoryItem {
  messageId: string;
  kind: string;
  direction: "in" | "out";
  fromSession: string;
  toSession: string;
  requestId: string | null;
  replyTo: string | null;
  body: string;
  createdAt: string;
  expiresAt: string | null;
  deliveryStatus: string | null;
}

export interface AuditServiceDeps {
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  requests: RequestRepository;
  sessions: SessionRepository;
  events: EventRepository;
  now?: () => string;
}

function parseData(json: string | null): Record<string, unknown> | null {
  if (json === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const EVENT_STAGES: Record<string, string> = {
  send: "stored",
  notify: "notified",
  inbox_claim: "delivered",
  ack: "acked",
  reply: "replied",
  cancel: "cancelled",
  notify_fail: "notify_failed",
  expire: "expired",
  dead_letter: "dead_letter",
};

const STAGE_RANK: Record<string, number> = {
  stored: 0,
  notified: 1,
  notify_failed: 1,
  delivered: 2,
  acked: 3,
  replied: 4,
  cancelled: 4,
  expired: 4,
  dead_letter: 4,
};

function stageOf(event: string): string {
  return EVENT_STAGES[event] ?? event;
}

function chainEvent(event: EventRecord): AuditChainEvent {
  return {
    event: event.event,
    stage: stageOf(event.event),
    ts: event.ts,
    level: event.level,
    sessionId: event.sessionId,
    deliveryId: event.deliveryId,
    requestId: event.requestId,
    errorCode: event.errorCode,
    errorDetail: redactErrorDetail(event.errorDetail),
    data: parseData(event.dataJson),
  };
}

function compareChainEvents(left: EventRecord, right: EventRecord): number {
  const leftRank = STAGE_RANK[stageOf(left.event)] ?? 99;
  const rightRank = STAGE_RANK[stageOf(right.event)] ?? 99;
  return (
    leftRank - rightRank ||
    left.ts.localeCompare(right.ts) ||
    left.eventId.localeCompare(right.eventId)
  );
}

/**
 * Read-side audit. It may append a `log_read` event when --as is supplied, but
 * it never changes message or delivery state.
 */
export class AuditService {
  private readonly messages: MessageRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly requests: RequestRepository;
  private readonly sessions: SessionRepository;
  private readonly events: EventRepository;
  private readonly now: () => string;

  constructor(deps: AuditServiceDeps) {
    this.messages = deps.messages;
    this.deliveries = deps.deliveries;
    this.requests = deps.requests;
    this.sessions = deps.sessions;
    this.events = deps.events;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  log(input: AuditLogInput): AuditLogEntry {
    const message = this.messages.get(input.messageId);
    if (message === undefined) {
      throw new AechatError(
        "delivery_not_found",
        `message not found: ${input.messageId}`,
      );
    }
    if (input.asSession !== undefined) {
      if (this.sessions.get(input.asSession) === undefined) {
        throw new AechatError(
          "session_not_found",
          `session not found: ${input.asSession}`,
        );
      }
    }
    this.events.record({
      event: "log_read",
      sessionId: input.asSession ?? null,
      ts: this.now(),
      data: { messageId: input.messageId },
    });

    const delivery =
      input.deliveryId === undefined
        ? this.deliveries.getByMessageId(input.messageId)
        : this.deliveries.get(input.deliveryId);
    if (
      input.deliveryId !== undefined &&
      (delivery === undefined || delivery.messageId !== input.messageId)
    ) {
      throw new AechatError(
        "delivery_not_found",
        `delivery ${input.deliveryId} does not belong to message ${input.messageId}`,
      );
    }
    const requestId = message.requestId ?? message.messageId;
    const request = this.requests.get(requestId);

    return {
      messageId: message.messageId,
      kind: message.kind,
      fromSession: message.fromSession,
      toSession: message.toSession,
      requestId: message.requestId,
      deliveryId: delivery?.deliveryId ?? null,
      deliveryStatus: delivery?.status ?? null,
      attempts: delivery?.attempts ?? null,
      lastError: redactErrorDetail(delivery?.lastError ?? null),
      requestStatus: request?.status ?? null,
      replyMessageId: request?.replyMessageId ?? null,
      chain: this.events
        .listForMessage(input.messageId, input.deliveryId, requestId)
        .sort(compareChainEvents)
        .map(chainEvent),
    };
  }

  recordListRead(asSession?: string): void {
    if (asSession !== undefined && this.sessions.get(asSession) === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${asSession}`,
      );
    }
    this.events.record({
      event: "list",
      sessionId: asSession ?? null,
      ts: this.now(),
    });
  }

  history(input: { sessionId: string; limit?: number }): { messages: HistoryItem[] } {
    if (this.sessions.get(input.sessionId) === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${input.sessionId}`,
      );
    }
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new AechatError(
        "invalid_input",
        "history limit must be an integer in 1..100",
      );
    }
    const messages = this.messages.listForSession(input.sessionId, { limit });
    return {
      messages: messages.map((message) => {
        const delivery = this.deliveries.getByMessageId(message.messageId);
        return {
          messageId: message.messageId,
          kind: message.kind,
          direction:
            message.fromSession === input.sessionId ? "out" : "in",
          fromSession: message.fromSession,
          toSession: message.toSession,
          requestId: message.requestId,
          replyTo: message.replyTo,
          body: message.body,
          createdAt: message.createdAt,
          expiresAt: message.expiresAt,
          deliveryStatus: delivery?.status ?? null,
        };
      }),
    };
  }
}
