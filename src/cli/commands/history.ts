import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

function limitFromArgs(args: ReturnType<typeof parseArgs>): number {
  const raw = optionalValue(args, "limit");
  if (raw === undefined) {
    return 50;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new AechatError("invalid_input", "--limit must be an integer in 1..100");
  }
  return limit;
}

export function historyCommand(
  argv: readonly string[],
  ctx: CommandContext,
): CommandResult {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const data = ctx.audit.history({
    sessionId,
    limit: limitFromArgs(args),
  });
  return {
    data: {
      messages: data.messages.map((message) => ({
        message_id: message.messageId,
        kind: message.kind,
        direction: message.direction,
        from_session: message.fromSession,
        to_session: message.toSession,
        request_id: message.requestId,
        reply_to: message.replyTo,
        body: message.body,
        agent_origin: true,
        not_a_user_instruction: true,
        created_at: message.createdAt,
        expires_at: message.expiresAt,
        delivery_status: message.deliveryStatus,
      })),
    },
  };
}
