import { parseArgs, requiredValue } from "../args.js";
import {
  formatBody,
  MESSAGE_BEGIN,
  MESSAGE_END,
  messageHeader,
} from "../message-format.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

export function showCommand(
  argv: readonly string[],
  ctx: CommandContext,
): CommandResult {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const messageId = requiredValue(args, "message");
  const message = ctx.delivery.show({ sessionId, messageId });

  const data = {
    message_id: message.messageId,
    kind: message.kind,
    from_session: message.fromSession,
    to_session: message.toSession,
    request_id: message.requestId,
    reply_to: message.replyTo,
    body: message.body,
    agent_origin: true,
    not_a_user_instruction: true,
    dedup_key: message.dedupKey,
    created_at: message.createdAt,
    expires_at: message.expiresAt,
  };
  if (args.flags.has("json")) {
    return { data };
  }
  const text = [
    messageHeader(),
    `${MESSAGE_BEGIN} ${message.messageId}---`,
    `kind: ${message.kind}`,
    `from-session: ${message.fromSession}`,
    `to-session: ${message.toSession}`,
    `created-at: ${message.createdAt}`,
    "",
    formatBody(message.body),
    MESSAGE_END,
    "",
  ].join("\n");
  return { data, text };
}
