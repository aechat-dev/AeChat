import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export async function leaveCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  await ctx.service.leave(sessionId);
  return { session_id: sessionId, status: "left" };
}
