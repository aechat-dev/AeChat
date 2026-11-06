import type { CommandContext } from "./context.js";
import { parseArgs, requiredValue } from "../args.js";

export function heartbeatCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Record<string, unknown> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  ctx.service.heartbeat(sessionId, ctx.now());
  const session = ctx.service.whoami({ sessionId });
  return {
    session_id: session.sessionId,
    last_seen_at: session.lastSeenAt,
    host_seen_at: session.hostSeenAt,
  };
}
