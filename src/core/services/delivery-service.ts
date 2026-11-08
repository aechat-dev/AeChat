import type { DatabaseSync } from "node:sqlite";

import { AechatError } from "../errors.js";
import { newId } from "../ids.js";
import { redactErrorDetail } from "../log-redaction.js";
import { withImmediate } from "../store/db.js";
import type { EventRepository } from "../store/events.js";
import type {
  DeliveryRecord,
  DeliveryRepository,
  MessageKind,
  MessageRecord,
  MessageRepository,
} from "../store/messages.js";
import type { RequestRepository } from "../store/requests.js";
import type {
  SessionRepository,
  TransportBindingRepository,
} from "../store/sessions.js";
import { nowIso } from "../time.js";
import type {
  PointerNotification,
  TransportAdapter,
  TransportBinding,
} from "../transport/adapter.js";
import type { TransportBindingRecord } from "../types.js";

export const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_LEASE_SECONDS = 30;
const WAIT_POLL_MS = 250;

export interface SendInput {
  fromSession: string;
  toSession: string;
  kind: MessageKind;
  body: string;
  dedupKey?: string;
  ttlSeconds?: number;
  deadlineSeconds?: number;
  now?: string;
}

export interface SendRequestInput {
  fromSession: string;
  toSession: string;
  body: string;
  deadlineSeconds?: number;
  dedupKey?: string;
  now?: string;
}

export interface RetryInput {
  sessionId: string;
  messageId?: string;
  deliveryId?: string;
}

export interface RetryResult {
  messageId: string;
  deliveryId: string;
  retried: boolean;
  status: SendStatus;
}

export type SendStatus =
  | "stored"
  | "notified"
  | "notify_failed"
  | "delivered"
  | "acked"
  | "expired"
  | "dead_letter";

export interface SendResult {
  messageId: string;
  deliveryId: string;
  status: SendStatus;
  error?: string;
}

export interface InboxItem {
  message: MessageRecord;
  delivery: DeliveryRecord;
  deliveryToken: string | null;
}

export interface InboxInput {
  sessionId: string;
  limit: number;
  peek?: boolean;
  now?: string;
}

export interface WaitInput {
  sessionId: string;
  timeoutSeconds: number;
  peek?: boolean;
  now?: string;
}

export interface AckInput {
  sessionId: string;
  token: string;
  now?: string;
}

export interface ShowInput {
  sessionId: string;
  messageId: string;
}

export interface DeliveryServiceDeps {
  db: DatabaseSync;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  requests?: RequestRepository;
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  transport: TransportAdapter;
  events?: EventRepository;
  now?: () => string;
  newId?: () => string;
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

function adapterBinding(record: TransportBindingRecord): TransportBinding {
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

function deliveryStatus(delivery: DeliveryRecord | undefined): SendStatus {
  return delivery?.status ?? "stored";
}

/**
 * Owns message persistence and the two-phase notify flow. The message survives
 * a transport failure; callers can pull it later and retry the notification.
 */
export class DeliveryService {
  private readonly db: DatabaseSync;
  private readonly messages: MessageRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly requests: RequestRepository | undefined;
  private readonly sessions: SessionRepository;
  private readonly bindings: TransportBindingRepository;
  private readonly transport: TransportAdapter;
  private readonly events: EventRepository | undefined;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: DeliveryServiceDeps) {
    this.db = deps.db;
    this.messages = deps.messages;
    this.deliveries = deps.deliveries;
    this.requests = deps.requests;
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.transport = deps.transport;
    this.events = deps.events;
    this.now = deps.now ?? nowIso;
    this.newId = deps.newId ?? newId;
  }

  async send(input: SendInput): Promise<SendResult> {
    if (input.kind !== "notify" && input.kind !== "request") {
      throw new AechatError(
        "invalid_input",
        "send accepts kind=notify or kind=request; replies use reply()",
      );
    }
    if (input.deadlineSeconds !== undefined) {
      if (input.kind !== "request") {
        throw new AechatError(
          "invalid_input",
          "deadline is only valid for a request",
        );
      }
      if (input.deadlineSeconds <= 0) {
        throw new AechatError("invalid_input", "deadline must be positive");
      }
    }
    if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) {
      throw new AechatError("invalid_body", "message body exceeds 16 KiB");
    }
    if (input.ttlSeconds !== undefined && input.ttlSeconds <= 0) {
      throw new AechatError("invalid_input", "ttl must be a positive integer");
    }

    const from = this.sessions.get(input.fromSession);
    if (from === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${input.fromSession}`,
      );
    }
    const to = this.sessions.get(input.toSession);
    if (to === undefined) {
      throw new AechatError(
        "target_not_found",
        `target session not found: ${input.toSession}`,
      );
    }
    if (to.leftAt !== null) {
      throw new AechatError(
        "target_left",
        `target has left: ${input.toSession}`,
      );
    }

    const at = input.now ?? this.now();
    if (input.kind === "request" && this.requests === undefined) {
      throw new AechatError(
        "internal",
        "request messages require the request repository",
      );
    }
    const deadline =
      input.deadlineSeconds === undefined
        ? null
        : new Date(Date.parse(at) + input.deadlineSeconds * 1000).toISOString();
    const messageId = this.newId();
    const deliveryId = this.newId();
    const expiresAt =
      input.ttlSeconds === undefined
        ? null
        : new Date(Date.parse(at) + input.ttlSeconds * 1000).toISOString();

    let duplicate: SendResult | undefined;
    withImmediate(this.db, () => {
      // Dedup lookup and insertion share one writer transaction. Two processes
      // using the same key serialize here: the loser sees the winner's row and
      // returns it (same target) or gets invalid_input (different target)
      // instead of hitting the unique index as an internal SQLite error.
      if (input.dedupKey !== undefined) {
        const existing = this.messages.findByDedupKeyFromSender(
          input.fromSession,
          input.dedupKey,
        );
        const exact = existing.find(
          (message) =>
            message.toSession === input.toSession &&
            message.kind === input.kind &&
            message.body === input.body,
        );
        if (exact !== undefined) {
          duplicate = this.duplicateResult(exact, input.toSession);
          return;
        }
        if (existing.length > 0) {
          throw new AechatError(
            "invalid_input",
            "dedup key already used with a different target, body or kind",
            { dedupKey: input.dedupKey },
          );
        }
      }

      this.messages.insert({
        messageId,
        kind: input.kind,
        fromSession: input.fromSession,
        toSession: input.toSession,
        requestId: input.kind === "request" ? messageId : null,
        body: input.body,
        createdAt: at,
        dedupKey: input.dedupKey ?? null,
        expiresAt,
      });
      this.deliveries.insert({
        deliveryId,
        messageId,
        sessionId: input.toSession,
      });
      if (input.kind === "request") {
        (this.requests as RequestRepository).insert({
          requestId: messageId,
          requesterSession: input.fromSession,
          targetSession: input.toSession,
          deadline,
          createdAt: at,
        });
      }
      this.events?.record({
        event: "send",
        sessionId: input.fromSession,
        messageId,
        deliveryId,
        ts: at,
        data: { toSession: input.toSession, kind: input.kind },
      });
    });
    if (duplicate !== undefined) {
      return duplicate;
    }

    return this.notifyDelivery({
      messageId,
      deliveryId,
      fromSession: input.fromSession,
      toSession: input.toSession,
    });
  }

  /**
   * Notify the target about a message that is already persisted together with
   * its delivery row. Callers own the transaction that created them; a failed
   * notification leaves the delivery pullable.
   */
  async notifyDelivery(input: {
    messageId: string;
    deliveryId: string;
    fromSession: string;
    toSession: string;
  }): Promise<SendResult> {
    const toBinding = this.bindings.listForSession(input.toSession).at(-1);
    const fromBinding = this.bindings.listForSession(input.fromSession).at(-1);
    if (
      toBinding === undefined ||
      toBinding.mode === "off" ||
      toBinding.mode === "unknown"
    ) {
      return {
        messageId: input.messageId,
        deliveryId: input.deliveryId,
        status: "stored",
      };
    }

    const notification: PointerNotification = {
      messageId: input.messageId,
      fromSession: input.fromSession,
      toSession: input.toSession,
      ...(fromBinding === undefined
        ? {}
        : { fromAddress: fromBinding.address }),
    };

    let notifyResult: { ok: boolean; error?: string };
    try {
      notifyResult = await this.transport.notify(
        adapterBinding(toBinding),
        notification,
      );
    } catch (error) {
      notifyResult = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const notifyAt = this.now();
    if (notifyResult.ok) {
      withImmediate(this.db, () => {
        this.deliveries.markNotified(input.deliveryId, notifyAt);
        this.events?.record({
          event: "notify",
          sessionId: input.toSession,
          messageId: input.messageId,
          deliveryId: input.deliveryId,
          transport: toBinding.transport,
          mode: toBinding.mode,
          ts: notifyAt,
        });
      });
      return {
        messageId: input.messageId,
        deliveryId: input.deliveryId,
        status: "notified",
      };
    }

    const error =
      redactErrorDetail(notifyResult.error ?? "transport notify failed") ??
      "transport notify failed";
    withImmediate(this.db, () => {
      this.deliveries.markNotifyFailed(input.deliveryId, error);
      this.events?.record({
        event: "notify_fail",
        level: "warn",
        sessionId: input.toSession,
        messageId: input.messageId,
        deliveryId: input.deliveryId,
        transport: toBinding.transport,
        mode: toBinding.mode,
        ts: notifyAt,
        errorDetail: error,
      });
    });
    return {
      messageId: input.messageId,
      deliveryId: input.deliveryId,
      status: "notify_failed",
      error,
    };
  }

  sendRequest(input: SendRequestInput): Promise<SendResult> {
    return this.send({
      fromSession: input.fromSession,
      toSession: input.toSession,
      kind: "request",
      body: input.body,
      ...(input.deadlineSeconds === undefined
        ? {}
        : { deadlineSeconds: input.deadlineSeconds }),
      ...(input.dedupKey === undefined ? {} : { dedupKey: input.dedupKey }),
      ...(input.now === undefined ? {} : { now: input.now }),
    });
  }

  async retry(input: RetryInput): Promise<RetryResult> {
    if ((input.messageId === undefined) === (input.deliveryId === undefined)) {
      throw new AechatError(
        "invalid_input",
        "retry requires exactly one of messageId or deliveryId",
      );
    }
    const delivery =
      input.deliveryId === undefined
        ? this.deliveries.getByMessageId(input.messageId as string)
        : this.deliveries.get(input.deliveryId);
    if (delivery === undefined) {
      throw new AechatError(
        "delivery_not_found",
        "delivery not found for retry",
      );
    }
    const message = this.messages.get(delivery.messageId);
    if (message === undefined) {
      throw new AechatError(
        "delivery_not_found",
        `message not found: ${delivery.messageId}`,
      );
    }
    if (message.fromSession !== input.sessionId) {
      throw new AechatError(
        "not_actor",
        "only the sender may retry this message",
      );
    }

    if (delivery.status !== "stored" && delivery.status !== "notify_failed") {
      return {
        messageId: message.messageId,
        deliveryId: delivery.deliveryId,
        retried: false,
        status: delivery.status,
      };
    }
    if (!this.deliveries.resetForRetry(delivery.deliveryId)) {
      const current = this.deliveries.get(delivery.deliveryId);
      return {
        messageId: message.messageId,
        deliveryId: delivery.deliveryId,
        retried: false,
        status: current?.status ?? "stored",
      };
    }

    const result = await this.notifyDelivery({
      messageId: message.messageId,
      deliveryId: delivery.deliveryId,
      fromSession: message.fromSession,
      toSession: message.toSession,
    });
    return {
      messageId: result.messageId,
      deliveryId: result.deliveryId,
      retried: true,
      status: result.status,
    };
  }

  async inbox(input: InboxInput): Promise<InboxItem[]> {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new AechatError(
        "invalid_input",
        "inbox limit must be a positive integer",
      );
    }
    const at = input.now ?? this.now();
    if (input.peek === true) {
      const pending = this.deliveries.listPending({
        sessionId: input.sessionId,
        limit: input.limit,
        now: at,
      });
      // Peek never hands out a usable token, including a stale token left on
      // a delivery whose lease already expired.
      return this.toItems(
        pending.map((delivery) => ({ ...delivery, deliveryToken: null })),
      );
    }

    const claimed = this.deliveries.claim({
      sessionId: input.sessionId,
      limit: input.limit,
      now: at,
      leaseSeconds: DEFAULT_LEASE_SECONDS,
      onTransition: (transition) => {
        this.events?.record({
          event: transition.event,
          sessionId: transition.sessionId,
          messageId: transition.messageId,
          deliveryId: transition.deliveryId,
          ts: at,
          data:
            transition.event === "expire"
              ? { reason: "ttl", attempts: transition.attempts }
              : { reason: "lease_exhausted", attempts: transition.attempts },
        });
      },
    });
    for (const delivery of claimed) {
      this.events?.record({
        event: "inbox_claim",
        sessionId: input.sessionId,
        messageId: delivery.messageId,
        deliveryId: delivery.deliveryId,
        ts: at,
        data: { attempts: delivery.attempts },
      });
    }
    return this.toItems(claimed);
  }

  async wait(input: WaitInput): Promise<InboxItem[] | null> {
    if (input.timeoutSeconds < 0) {
      throw new AechatError(
        "invalid_input",
        "wait timeout must not be negative",
      );
    }
    const deadline = Date.now() + input.timeoutSeconds * 1000;
    for (;;) {
      const items = await this.inbox({
        sessionId: input.sessionId,
        limit: 1,
        ...(input.peek === undefined ? {} : { peek: input.peek }),
        ...(input.now === undefined ? {} : { now: input.now }),
      });
      if (items.length > 0) {
        return items;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return null;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(WAIT_POLL_MS, remaining));
      });
    }
  }

  ack(input: AckInput): boolean {
    const at = input.now ?? this.now();
    const delivery = this.deliveries.getByToken(input.token, input.sessionId);
    const wasDelivered = delivery?.status === "delivered";
    return withImmediate(this.db, () => {
      const ok = this.deliveries.ack(input.token, input.sessionId, at);
      if (ok && wasDelivered) {
        this.events?.record({
          event: "ack",
          sessionId: input.sessionId,
          messageId: delivery?.messageId ?? null,
          deliveryId: delivery?.deliveryId ?? null,
          ts: at,
          data: { tokenPresent: true },
        });
      }
      return ok;
    });
  }

  show(input: ShowInput): MessageRecord {
    const message = this.messages.get(input.messageId);
    if (message === undefined) {
      throw new AechatError(
        "delivery_not_found",
        `message not found: ${input.messageId}`,
      );
    }
    if (message.fromSession === input.sessionId) {
      return message;
    }
    if (message.toSession !== input.sessionId) {
      throw new AechatError(
        "not_actor",
        "only the sender or the target session may read this message",
      );
    }
    const delivery = this.deliveries.getForMessageSession(
      message.messageId,
      input.sessionId,
    );
    if (
      delivery === undefined ||
      (delivery.status !== "delivered" && delivery.status !== "acked")
    ) {
      throw new AechatError(
        "not_delivered",
        "target may read the message only after it was delivered",
      );
    }
    return message;
  }

  private duplicateResult(
    message: MessageRecord,
    toSession: string,
  ): SendResult {
    const delivery = this.deliveries.getForMessageSession(
      message.messageId,
      toSession,
    );
    const status = deliveryStatus(delivery);
    return delivery === undefined
      ? { messageId: message.messageId, deliveryId: "", status }
      : {
          messageId: message.messageId,
          deliveryId: delivery.deliveryId,
          status,
          ...(delivery.lastError === null ? {} : { error: delivery.lastError }),
        };
  }

  private toItems(deliveries: DeliveryRecord[]): InboxItem[] {
    const items: InboxItem[] = [];
    for (const delivery of deliveries) {
      const message = this.messages.get(delivery.messageId);
      if (message !== undefined) {
        items.push({
          message,
          delivery,
          deliveryToken: delivery.deliveryToken,
        });
      }
    }
    return items;
  }
}
