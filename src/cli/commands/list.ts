import { parseArgs } from "../args.js";
import type { CommandContext } from "./context.js";

export async function listCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const includeLeft = args.flags.has("all");
  ctx.audit.recordListRead(args.values.get("as"));
  const sessions = await ctx.sessionQuery.list({ includeLeft });

  return { sessions };
}
