import { parseArgs } from "../args.js";
import type { UiCommandContext } from "./ui-context.js";

export async function uiSnapshotCommand(
  argv: readonly string[],
  ctx: UiCommandContext,
): Promise<Record<string, unknown>> {
  parseArgs(argv);
  return { ...(await ctx.ui.snapshot()) };
}
