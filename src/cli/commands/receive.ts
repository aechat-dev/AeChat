import { AechatError } from "../../core/errors.js";
import type { InboxItem } from "../../core/services/delivery-service.js";
import {
  optionalSeconds,
  type ParsedArgs,
  parseArgs,
  requiredValue,
} from "../args.js";
import { inboxItemDto } from "../message-dto.js";
import { formatInboxText } from "../message-format.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

const VALUE_OPTIONS = new Set(["session", "timeout"]);
const FLAG_OPTIONS = new Set(["json"]);

/**
 * `receive` always claims, so silently accepting `--peek` or `--request`
 * would claim a delivery the caller meant to inspect only. Reject every
 * option outside this command's contract before touching the store.
 */
function rejectUnsupportedOptions(args: ParsedArgs): void {
  for (const key of args.values.keys()) {
    if (!VALUE_OPTIONS.has(key)) {
      throw new AechatError(
        "invalid_input",
        `receive does not support --${key}`,
      );
    }
  }
  for (const key of args.flags) {
    if (!FLAG_OPTIONS.has(key)) {
      throw new AechatError(
        "invalid_input",
        `receive does not support --${key}`,
      );
    }
  }
}

/**
 * High-level receive path: claim at most one delivery and return it. It never
 * acknowledges: the agent must still call `ack` after processing, so a crash
 * between claim and processing is visible in the lease/retry state.
 */
export async function receiveCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const args = parseArgs(argv);
  rejectUnsupportedOptions(args);
  const sessionId = requiredValue(args, "session");
  const timeoutSeconds = optionalSeconds(args, "timeout", 0);

  const items = await ctx.delivery.wait({ sessionId, timeoutSeconds });
  const item = (items as InboxItem[] | null)?.[0];
  if (item === undefined) {
    const data = { status: "timeout" };
    return args.flags.has("json")
      ? { data, exitCode: 2 }
      : { data, text: "timeout\n", exitCode: 2 };
  }

  const data = { status: "delivered", message: inboxItemDto(item) };
  return args.flags.has("json")
    ? { data }
    : { data, text: formatInboxText([item]) };
}
