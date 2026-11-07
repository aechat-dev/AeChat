import type { ReadOnlyRuntime } from "./read-only-runtime.js";
import {
  AuditQueryService,
  parseEventData,
  type AuditLogEntry,
} from "../core/services/audit-query.js";
import type { RequestRecord, RequestStatus } from "../core/store/requests.js";
import type { MessageRecord, ThreadRecord } from "../core/store/messages.js";
import type {
  ThreadSummary,
  UiAuditEvent,
  UiCounts,
  UiEvent,
  UiLog,
  UiMessage,
  UiMessagePage,
  UiSnapshot,
} from "../contracts/ui.js";
import type { SessionView } from "../contracts/ui.js";
import { AechatError } from "../core/errors.js";

export interface UiMessageInput {
  sessionId: string;
  counterpartId?: string;
  before?: string;
  limit?: number;
}

const PREVIEW_LIMIT = 120;
const MESSAGE_LIMIT_MAX = 200;
const MESSAGE_LIMIT_DEFAULT = 50;

function preview(body: string): string {
  const plain = body
    // Control characters other than tab/newline would break list rendering.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const chars = Array.from(plain);
  return chars.length <= PREVIEW_LIMIT
    ? plain
    : `${chars.slice(0, PREVIEW_LIMIT - 1).join("")}…`;
}

function parseCursor(before: string | undefined): { createdAt: string; messageId: string } | undefined {
  if (before === undefined) {
    return undefined;
  }
  const separator = before.lastIndexOf("|");
  if (separator <= 0 || separator === before.length - 1) {
    throw new AechatError("invalid_input", "before cursor must be <created_at>|<message_id>");
  }
  return {
    createdAt: before.slice(0, separator),
    messageId: before.slice(separator + 1),
  };
}

function cursorOf(message: MessageRecord): string {
  return `${message.createdAt}|${message.messageId}`;
}

function threadSummary(record: ThreadRecord): ThreadSummary {
  return {
    key: `${record.aSession}|${record.bSession}`,
    participants: [
      {
        session_id: record.aSession,
        display_name: record.aDisplayName,
        client: record.aClient,
        project: record.aProject,
      },
      {
        session_id: record.bSession,
        display_name: record.bDisplayName,
        client: record.bClient,
        project: record.bProject,
      },
    ],
    last_message_at: record.lastCreatedAt,
    last_message: {
      message_id: record.lastMessageId,
      kind: record.lastKind,
      preview: preview(record.lastBody),
    },
    pending_requests: record.pendingRequests,
    pending_deliveries: record.pendingDeliveries,
  };
}

function countSessions(sessions: SessionView[]): UiCounts {
  const counts: UiCounts = {
    sessions: sessions.length,
    online: 0,
    offline: 0,
    unknown: 0,
    left: 0,
    pending_requests: 0,
    pending_deliveries: 0,
  };
  for (const session of sessions) {
    switch (session.status) {
      case "online":
        counts.online += 1;
        break;
      case "offline":
        counts.offline += 1;
        break;
      case "left":
        counts.left += 1;
        break;
      default:
        counts.unknown += 1;
    }
  }
  return counts;
}

function auditEvent(event: AuditLogEntry["chain"][number]): UiAuditEvent {
  return {
    event: event.event,
    stage: event.stage,
    ts: event.ts,
    level: event.level,
    session_id: event.sessionId,
    delivery_id: event.deliveryId,
    request_id: event.requestId,
    error_code: event.errorCode,
    error_detail: event.errorDetail,
    data: event.data,
  };
}

interface EffectiveRequest {
  status: RequestStatus | null;
  closeReason: string | null;
  deadline: string | null;
}

/**
 * A request whose deadline passed is effectively expired even if no writer
 * has called expireOverdue yet. The read path must not write, so derive it.
 */
function effectiveRequest(
  request: RequestRecord | undefined,
  now: string,
): EffectiveRequest {
  if (request === undefined) {
    return { status: null, closeReason: null, deadline: null };
  }
  if (
    request.status === "open" &&
    request.deadline !== null &&
    request.deadline <= now
  ) {
    return { status: "expired", closeReason: "deadline", deadline: request.deadline };
  }
  return {
    status: request.status,
    closeReason: request.closeReason,
    deadline: request.deadline,
  };
}

/** Read-only facade used by every `ui-*` bridge command. */
export class UiQueryService {
  private readonly runtime: ReadOnlyRuntime;
  private readonly audit: AuditQueryService;

  constructor(runtime: ReadOnlyRuntime) {
    this.runtime = runtime;
    this.audit = new AuditQueryService({
      messages: runtime.messages,
      deliveries: runtime.deliveries,
      requests: runtime.requests,
      events: runtime.events,
    });
  }

  async snapshot(): Promise<UiSnapshot> {
    const sessions = await this.runtime.sessionQuery.list({ includeLeft: true });
    const threads = this.runtime.messages
      .listThreads(this.runtime.now())
      .map(threadSummary);
    const counts = countSessions(sessions);
    for (const thread of threads) {
      counts.pending_requests += thread.pending_requests;
      counts.pending_deliveries += thread.pending_deliveries;
    }
    return {
      generated_at: this.runtime.now(),
      counts,
      sessions,
      threads,
    };
  }

  messages(input: UiMessageInput): UiMessagePage {
    const session = this.runtime.sessions.get(input.sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${input.sessionId}`,
      );
    }
    if (input.counterpartId !== undefined) {
      if (this.runtime.sessions.get(input.counterpartId) === undefined) {
        throw new AechatError(
          "session_not_found",
          `session not found: ${input.counterpartId}`,
        );
      }
      if (input.counterpartId === input.sessionId) {
        throw new AechatError("invalid_input", "counterpart must differ from session");
      }
    }
    const limit = input.limit ?? MESSAGE_LIMIT_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGE_LIMIT_MAX) {
      throw new AechatError(
        "invalid_input",
        `limit must be an integer in 1..${MESSAGE_LIMIT_MAX}`,
      );
    }
    const before = parseCursor(input.before);
    const records = this.runtime.messages.listPage({
      sessionId: input.sessionId,
      ...(input.counterpartId === undefined
        ? {}
        : { counterpartId: input.counterpartId }),
      ...(before === undefined ? {} : { before }),
      limit: limit + 1,
    });
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    return {
      messages: page.map((message) => this.message(message, input.sessionId)),
      next_before: hasMore && page.length > 0 ? cursorOf(page[page.length - 1] as MessageRecord) : null,
    };
  }

  events(after: number, limit = 200): UiEvent[] {
    return this.runtime.events.listAfter(after, limit).map((event) => ({
      kind: "event",
      seq: event.seq,
      event: event.event,
      ts: event.ts,
      level: event.level,
      session_id: event.sessionId,
      message_id: event.messageId,
      delivery_id: event.deliveryId,
      request_id: event.requestId,
      data: parseEventData(event.dataJson),
    }));
  }

  log(input: { messageId: string; deliveryId?: string }): UiLog {
    const entry = this.audit.log(input);
    const requestId = entry.requestId ?? entry.messageId;
    const effective = effectiveRequest(
      this.runtime.requests.get(requestId),
      this.runtime.now(),
    );
    return {
      message_id: entry.messageId,
      kind: entry.kind,
      from_session: entry.fromSession,
      to_session: entry.toSession,
      request_id: entry.requestId,
      delivery_id: entry.deliveryId,
      delivery_status: entry.deliveryStatus,
      attempts: entry.attempts,
      last_error: entry.lastError,
      request_status: effective.status,
      request_deadline: effective.deadline,
      request_close_reason: effective.closeReason,
      reply_message_id: entry.replyMessageId,
      chain: entry.chain.map(auditEvent),
    };
  }

  private message(record: MessageRecord, sessionId: string): UiMessage {
    const delivery = this.runtime.deliveries.getByMessageId(record.messageId);
    const requestId = record.requestId ?? record.messageId;
    const request =
      record.kind === "request" || record.kind === "reply"
        ? effectiveRequest(this.runtime.requests.get(requestId), this.runtime.now())
        : { status: null, closeReason: null, deadline: null };
    return {
      message_id: record.messageId,
      kind: record.kind,
      direction: record.fromSession === sessionId ? "out" : "in",
      from_session: record.fromSession,
      to_session: record.toSession,
      request_id: record.requestId,
      reply_to: record.replyTo,
      body: record.body,
      agent_origin: true,
      not_a_user_instruction: true,
      created_at: record.createdAt,
      expires_at: record.expiresAt,
      delivery_status: delivery?.status ?? null,
      request_status: request.status,
      request_deadline: request.deadline,
      request_close_reason: request.closeReason,
    };
  }
}
