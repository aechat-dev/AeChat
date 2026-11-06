import type { InboxItem } from "../../core/services/delivery-service.js";
import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import { formatInboxText } from "../message-format.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

function limitFromArgs(args: ReturnType<typeof parseArgs>): number {
  const raw = optionalValue(args, "limit");
  if (raw === undefined) {
    return 20;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new AechatError("invalid_input", "--limit must be an integer in 1..100");
  }
  return limit;
}

function itemDto(item: InboxItem): Record<string, unknown> {
  return {
    message_id: item.message.messageId,
    kind: item.message.kind,
    from_session: item.message.fromSession,
    to_session: item.message.toSession,
    request_id: item.message.requestId,
    reply_to: item.message.replyTo,
    body: item.message.body,
    agent_origin: true,
    not_a_user_instruction: true,
    created_at: item.message.createdAt,
    expires_at: item.message.expiresAt,
    delivery_id: item.delivery.deliveryId,
    status: item.delivery.status,
    delivery_token: item.deliveryToken,
    lease_expires_at: item.delivery.leaseExpiresAt,
    attempts: item.delivery.attempts,
  };
}

export async function inboxCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const items = await ctx.delivery.inbox({
    sessionId,
    limit: limitFromArgs(args),
    peek: args.flags.has("peek"),
  });

  const data = { messages: items.map(itemDto) };
  if (args.flags.has("json")) {
    return { data };
  }
  return { data, text: formatInboxText(items) };
}
