import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import { formatInboxText } from "../message-format.js";
import { inboxItemDto } from "../message-dto.js";
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

  const data = { messages: items.map(inboxItemDto) };
  if (args.flags.has("json")) {
    return { data };
  }
  return { data, text: formatInboxText(items) };
}
