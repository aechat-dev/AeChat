import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { UiCommandContext } from "./ui-context.js";

export function uiLogCommand(
  argv: readonly string[],
  ctx: UiCommandContext,
): Record<string, unknown> {
  const args = parseArgs(argv);
  const messageId = requiredValue(args, "message");
  const deliveryId = optionalValue(args, "delivery");
  return {
    ...ctx.ui.log({
      messageId,
      ...(deliveryId === undefined ? {} : { deliveryId }),
    }),
  };
}
