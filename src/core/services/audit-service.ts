import { AechatError } from "../errors.js";
import type { EventRepository } from "../store/events.js";
import type {
  DeliveryRepository,
  MessageRepository,
} from "../store/messages.js";
import type { RequestRepository } from "../store/requests.js";
import type { SessionRepository } from "../store/sessions.js";
import {
  type AuditChainEvent,
  type AuditLogEntry,
  type AuditLogInput,
  AuditQueryService,
} from "./audit-query.js";

export type { AuditChainEvent, AuditLogEntry, AuditLogInput };

export interface AuditLogRequest extends AuditLogInput {
  asSession?: string;
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

/**
 * Writable audit facade for the CLI. `log` appends a `log_read` event; the
 * read-only `AuditQueryService.log` does not and is what `ui-log` uses.
 */
export class AuditService {
  private readonly messages: MessageRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly requests: RequestRepository;
  private readonly sessions: SessionRepository;
  private readonly events: EventRepository;
  private readonly query: AuditQueryService;
  private readonly now: () => string;

  constructor(deps: AuditServiceDeps) {
    this.messages = deps.messages;
    this.deliveries = deps.deliveries;
    this.requests = deps.requests;
    this.sessions = deps.sessions;
    this.events = deps.events;
    this.query = new AuditQueryService({
      messages: deps.messages,
      deliveries: deps.deliveries,
      requests: deps.requests,
      events: deps.events,
    });
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  log(input: AuditLogRequest): AuditLogEntry {
    // Validate the message first so a failed read does not leave a log_read
    // event behind.
    const entry = this.query.log(input);
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
    return entry;
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

  history(input: { sessionId: string; limit?: number }): {
    messages: HistoryItem[];
  } {
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
          direction: message.fromSession === input.sessionId ? "out" : "in",
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
