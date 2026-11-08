import { AechatError } from "../../core/errors.js";
import type { InboxItem } from "../../core/services/delivery-service.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import { inboxItemDto, messageDto } from "../message-dto.js";
import { formatInboxText, formatMessageText } from "../message-format.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

function timeoutFromArgs(args: ReturnType<typeof parseArgs>): number {
  const raw = optionalValue(args, "timeout");
  if (raw === undefined) {
    return 300;
  }
  const trimmed = raw.trim();
  const timeout = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new AechatError("invalid_input", "--timeout must be non-negative");
  }
  return timeout;
}

export async function waitCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const timeoutSeconds = timeoutFromArgs(args);
  const requestId = optionalValue(args, "request");

  if (requestId !== undefined) {
    const result = await ctx.request.wait(requestId, sessionId, timeoutSeconds);
    if (result.status === "replied") {
      const data = {
        status: "replied",
        message: messageDto(result.reply),
      };
      return args.flags.has("json")
        ? { data }
        : { data, text: formatMessageText(result.reply) };
    }
    const data = { status: result.status };
    return {
      data,
      ...(args.flags.has("json") ? {} : { text: `${result.status}\n` }),
      ...(result.status === "timeout" ? { exitCode: 2 } : {}),
    };
  }

  const items = await ctx.delivery.wait({
    sessionId,
    timeoutSeconds,
    peek: args.flags.has("peek"),
  });
  if (items === null) {
    const data = { status: "timeout", messages: [] };
    return {
      data,
      ...(args.flags.has("json") ? {} : { text: "timeout\n" }),
      exitCode: 2,
    };
  }
  const data = {
    status: "delivered",
    messages: (items as InboxItem[]).map(inboxItemDto),
  };
  return args.flags.has("json")
    ? { data }
    : { data, text: formatInboxText(items) };
}
