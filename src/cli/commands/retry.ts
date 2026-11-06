import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export async function retryCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const messageId = optionalValue(args, "message");
  const deliveryId = optionalValue(args, "delivery");
  if ((messageId === undefined) === (deliveryId === undefined)) {
    throw new AechatError(
      "invalid_input",
      "retry requires exactly one of --message or --delivery",
    );
  }

  const result = await ctx.delivery.retry({
    sessionId,
    ...(messageId === undefined ? {} : { messageId }),
    ...(deliveryId === undefined ? {} : { deliveryId }),
  });
  return {
    message_id: result.messageId,
    delivery_id: result.deliveryId,
    retried: result.retried,
    status: result.status,
  };
}
