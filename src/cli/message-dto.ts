import type { InboxItem } from "../core/services/delivery-service.js";
import type { MessageRecord } from "../core/store/messages.js";

export function messageDto(message: MessageRecord): Record<string, unknown> {
  return {
    message_id: message.messageId,
    kind: message.kind,
    from_session: message.fromSession,
    to_session: message.toSession,
    request_id: message.requestId,
    reply_to: message.replyTo,
    body: message.body,
    agent_origin: true,
    not_a_user_instruction: true,
    created_at: message.createdAt,
    expires_at: message.expiresAt,
  };
}

export function inboxItemDto(item: InboxItem): Record<string, unknown> {
  return {
    ...messageDto(item.message),
    delivery_id: item.delivery.deliveryId,
    status: item.delivery.status,
    delivery_token: item.deliveryToken,
    lease_expires_at: item.delivery.leaseExpiresAt,
    attempts: item.delivery.attempts,
  };
}
