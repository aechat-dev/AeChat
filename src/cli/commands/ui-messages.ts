import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { UiCommandContext } from "./ui-context.js";

export function uiMessagesCommand(
  argv: readonly string[],
  ctx: UiCommandContext,
): Record<string, unknown> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const counterpartId = optionalValue(args, "counterpart");
  const before = optionalValue(args, "before");
  const rawLimit = optionalValue(args, "limit");
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit)) {
      throw new AechatError("invalid_input", "--limit must be an integer");
    }
  }

  const page = ctx.ui.messages({
    sessionId,
    ...(counterpartId === undefined ? {} : { counterpartId }),
    ...(before === undefined ? {} : { before }),
    ...(limit === undefined ? {} : { limit }),
  });
  return { ...page };
}
