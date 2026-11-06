import { parseArgs, requiredValue } from "../args.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

export function cancelCommand(
  argv: readonly string[],
  ctx: CommandContext,
): CommandResult {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const requestId = requiredValue(args, "request");
  const cancelled = ctx.request.cancel(sessionId, requestId);
  return {
    data: { request_id: requestId, cancelled },
    ...(cancelled ? {} : { exitCode: 4 }),
  };
}
