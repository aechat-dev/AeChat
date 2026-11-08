import type { DatabaseSync } from "node:sqlite";

import { AechatError } from "../errors.js";
import { newId } from "../ids.js";
import { withImmediate } from "../store/db.js";
import type { EventRepository } from "../store/events.js";
import type {
  DeliveryRepository,
  MessageRecord,
  MessageRepository,
} from "../store/messages.js";
import type { RequestRecord, RequestRepository } from "../store/requests.js";
import { nowIso } from "../time.js";
import { type DeliveryService, MAX_BODY_BYTES } from "./delivery-service.js";

export interface ReplyInput {
  sessionId: string;
  requestId: string;
  body: string;
  now?: string;
}

export interface ReplyResult {
  messageId: string;
  alreadyReplied: boolean;
}

export type RequestWaitResult =
  | { status: "replied"; reply: MessageRecord }
  | { status: "expired" }
  | { status: "cancelled" }
  | { status: "timeout" };

export interface RequestServiceDeps {
  db: DatabaseSync;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  requests: RequestRepository;
  delivery: DeliveryService;
  events?: EventRepository;
  now?: () => string;
  newId?: () => string;
}

function closedError(request: RequestRecord): AechatError {
  if (request.status === "expired") {
    return new AechatError(
      "request_expired",
      `request expired: ${request.requestId}`,
      { deadline: request.deadline },
    );
  }
  if (request.status === "cancelled") {
    return new AechatError(
      "request_cancelled",
      `request cancelled: ${request.requestId}`,
    );
  }
  return new AechatError(
    "request_closed",
    `request is not open: ${request.requestId}`,
    {
      status: request.status,
    },
  );
}

/**
 * Request lifecycle: reply is a CAS from open to replied, with the reply
 * message and delivery written in the same transaction. The reply notification
 * happens after commit; a failure leaves the reply pullable.
 */
export class RequestService {
  private readonly db: DatabaseSync;
  private readonly messages: MessageRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly requests: RequestRepository;
  private readonly delivery: DeliveryService;
  private readonly events: EventRepository | undefined;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: RequestServiceDeps) {
    this.db = deps.db;
    this.messages = deps.messages;
    this.deliveries = deps.deliveries;
    this.requests = deps.requests;
    this.delivery = deps.delivery;
    this.events = deps.events;
    this.now = deps.now ?? nowIso;
    this.newId = deps.newId ?? newId;
  }

  async reply(input: ReplyInput): Promise<ReplyResult> {
    if (Buffer.byteLength(input.body, "utf8") > MAX_BODY_BYTES) {
      throw new AechatError("invalid_body", "message body exceeds 16 KiB");
    }
    const at = input.now ?? this.now();
    // Expire in its own transaction: a late reply must leave the observable
    // request status as expired, not roll the lazy transition back.
    withImmediate(this.db, () => {
      this.expireRequest(input.requestId, at);
    });
    let outcome:
      | {
          messageId: string;
          alreadyReplied: boolean;
          deliveryId?: string;
          requestDeliveryId?: string | null;
          requestAlreadyAcked?: boolean;
          requesterSession?: string;
        }
      | undefined;

    withImmediate(this.db, () => {
      const request = this.requests.get(input.requestId);
      if (request === undefined) {
        throw new AechatError(
          "delivery_not_found",
          `request not found: ${input.requestId}`,
        );
      }
      if (request.targetSession !== input.sessionId) {
        throw new AechatError(
          "not_actor",
          "only the request target session may reply",
        );
      }
      if (request.status === "replied") {
        if (request.replyMessageId === null) {
          throw new AechatError(
            "internal",
            "request is replied but has no reply_message_id",
          );
        }
        outcome = {
          messageId: request.replyMessageId,
          alreadyReplied: true,
        };
        return;
      }
      if (request.status !== "open") {
        throw closedError(request);
      }

      const messageId = this.newId();
      const deliveryId = this.newId();
      this.messages.insert({
        messageId,
        kind: "reply",
        fromSession: input.sessionId,
        toSession: request.requesterSession,
        requestId: request.requestId,
        replyTo: request.requestId,
        body: input.body,
        createdAt: at,
      });
      this.deliveries.insert({
        deliveryId,
        messageId,
        sessionId: request.requesterSession,
      });
      if (!this.requests.markReplied(request.requestId, messageId, at)) {
        const latest = this.requests.get(request.requestId);
        if (
          latest?.deadline !== null &&
          latest?.deadline !== undefined &&
          latest.deadline <= at
        ) {
          throw new AechatError(
            "request_expired",
            `request expired: ${request.requestId}`,
          );
        }
        throw new AechatError(
          "request_closed",
          `request is no longer open: ${request.requestId}`,
        );
      }
      // A reply is also an acknowledgement of the request delivery.
      const requestDelivery = this.deliveries.getForMessageSession(
        request.requestId,
        input.sessionId,
      );
      this.deliveries.markReplied(request.requestId, input.sessionId, at);
      const completed = {
        messageId,
        alreadyReplied: false,
        deliveryId,
        requestDeliveryId: requestDelivery?.deliveryId ?? null,
        requestAlreadyAcked: requestDelivery?.status === "acked",
        requesterSession: request.requesterSession,
      };
      outcome = completed;
      this.events?.record({
        event: "send",
        sessionId: input.sessionId,
        messageId: completed.messageId,
        deliveryId: completed.deliveryId,
        requestId: input.requestId,
        ts: at,
        data: { kind: "reply" },
      });
      if (completed.requestAlreadyAcked !== true) {
        this.events?.record({
          event: "ack",
          sessionId: input.sessionId,
          messageId: input.requestId,
          deliveryId: completed.requestDeliveryId,
          requestId: input.requestId,
          ts: at,
          data: { by: "reply" },
        });
      }
      this.events?.record({
        event: "reply",
        sessionId: input.sessionId,
        messageId: completed.messageId,
        deliveryId: completed.deliveryId,
        requestId: input.requestId,
        ts: at,
        data: { replyMessageId: completed.messageId },
      });
    });

    if (outcome === undefined) {
      throw new AechatError(
        "internal",
        "reply transaction produced no outcome",
      );
    }
    if (outcome.alreadyReplied) {
      return {
        messageId: outcome.messageId,
        alreadyReplied: true,
      };
    }

    const deliveryId = outcome.deliveryId as string;
    const requesterSession = outcome.requesterSession as string;
    await this.delivery.notifyDelivery({
      messageId: outcome.messageId,
      deliveryId,
      fromSession: input.sessionId,
      toSession: requesterSession,
    });
    return {
      messageId: outcome.messageId,
      alreadyReplied: false,
    };
  }

  async wait(
    requestId: string,
    sessionId: string,
    timeoutSeconds: number,
  ): Promise<RequestWaitResult> {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
      throw new AechatError(
        "invalid_input",
        "wait timeout must be a non-negative number",
      );
    }
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      withImmediate(this.db, () => {
        this.expireRequest(requestId, this.now());
      });
      const request = this.requests.get(requestId);
      if (request === undefined) {
        throw new AechatError(
          "delivery_not_found",
          `request not found: ${requestId}`,
        );
      }
      if (
        request.requesterSession !== sessionId &&
        request.targetSession !== sessionId
      ) {
        throw new AechatError(
          "not_actor",
          "only the requester or target session may wait on this request",
        );
      }
      if (request.status === "replied") {
        if (request.replyMessageId === null) {
          throw new AechatError(
            "internal",
            "request is replied but has no reply_message_id",
          );
        }
        const reply = this.messages.get(request.replyMessageId);
        if (reply === undefined) {
          throw new AechatError("internal", "request reply message is missing");
        }
        return { status: "replied", reply };
      }
      if (request.status === "expired") {
        return { status: "expired" };
      }
      if (request.status === "cancelled") {
        return { status: "cancelled" };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { status: "timeout" };
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(250, remaining));
      });
    }
  }

  /**
   * Lazy deadline transition. Callers run this inside the same transaction as
   * the transition, so the audit event cannot survive a rolled-back state.
   */
  private expireRequest(requestId: string, at: string): boolean {
    if (!this.requests.expireOverdue(requestId, at)) {
      return false;
    }
    const request = this.requests.get(requestId);
    this.events?.record({
      event: "expire",
      sessionId: request?.targetSession ?? null,
      messageId: requestId,
      requestId,
      ts: at,
      data: {
        scope: "request",
        reason: "deadline",
        deadline: request?.deadline ?? null,
      },
    });
    return true;
  }

  cancel(sessionId: string, requestId: string): boolean {
    const at = this.now();
    withImmediate(this.db, () => {
      this.expireRequest(requestId, at);
    });
    const request = this.requests.get(requestId);
    if (request === undefined) {
      throw new AechatError(
        "delivery_not_found",
        `request not found: ${requestId}`,
      );
    }
    if (request.requesterSession !== sessionId) {
      throw new AechatError(
        "not_actor",
        "only the requester may cancel this request",
      );
    }
    if (request.status !== "open") {
      return false;
    }
    return withImmediate(this.db, () => {
      const cancelled = this.requests.markCancelled(requestId, sessionId, at);
      if (cancelled) {
        this.events?.record({
          event: "cancel",
          sessionId,
          messageId: requestId,
          requestId,
          ts: at,
          data: { closeReason: "sender_cancel" },
        });
      }
      return cancelled;
    });
  }
}
