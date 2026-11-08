import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export async function confirmCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  if (args.flags.has("resume")) {
    const session = await ctx.resume.confirm(sessionId);
    return {
      session_id: session.sessionId,
      bound_scope: session.boundScope,
      bound_checked_at: session.boundCheckedAt,
      resume_state: session.resumeState,
      resume_count: session.resumeCount,
    };
  }
  const result = await ctx.service.confirm(sessionId);
  return {
    session_id: result.session.sessionId,
    bound_scope: result.boundScope,
    bound_checked_at: result.session.boundCheckedAt,
  };
}
