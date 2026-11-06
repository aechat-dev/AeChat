import { parseArgs, requiredValue } from "../args.js";
import { bodyFromArgs } from "../body.js";
import type { CommandContext } from "./context.js";

export async function replyCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const requestId = requiredValue(args, "request");
  const result = await ctx.request.reply({
    sessionId,
    requestId,
    body: bodyFromArgs(args),
  });
  return {
    request_id: requestId,
    message_id: result.messageId,
    already_replied: result.alreadyReplied,
  };
}
