import { AechatError } from "../../core/errors.js";
import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export function ackCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Record<string, unknown> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const token = requiredValue(args, "delivery");
  if (!ctx.delivery.ack({ sessionId, token })) {
    throw new AechatError(
      "lease_expired",
      "delivery token is unknown, already expired, or belongs to another session",
    );
  }
  return { acked: true, delivery_token: token };
}
