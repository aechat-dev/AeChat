import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export async function resumeCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const result = await ctx.resume.begin({
    sessionId,
    force: args.flags.has("force"),
  });
  return {
    session_id: result.session.sessionId,
    resume_state: result.session.resumeState,
    address: result.binding.address,
    transport: result.binding.transport,
    bind_directive: result.bindDirective,
    forced: result.forced,
    risk: result.forced
      ? "old binding liveness could not be proven; resume was forced"
      : null,
  };
}
