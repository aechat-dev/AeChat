import type { CommandContext } from "./context.js";
import { parseArgs, requiredValue } from "../args.js";

export async function confirmCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const result = await ctx.service.confirm(sessionId);
  return {
    session_id: result.session.sessionId,
    bound_scope: result.boundScope,
    bound_checked_at: result.session.boundCheckedAt,
  };
}
