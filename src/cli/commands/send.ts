import { AechatError } from "../../core/errors.js";
import type { MessageKind } from "../../core/store/messages.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import { bodyFromArgs } from "../body.js";
import type { CommandContext } from "./context.js";

function targetFromArgs(
  args: ReturnType<typeof parseArgs>,
  ctx: CommandContext,
): string {
  const toSession = optionalValue(args, "to-session");
  const toName = optionalValue(args, "to-name");
  if ((toSession === undefined) === (toName === undefined)) {
    throw new AechatError(
      "invalid_input",
      "send requires exactly one of --to-session or --to-name",
    );
  }
  if (toSession !== undefined) {
    return toSession;
  }
  return ctx.service.resolveTargetByName(toName as string).sessionId;
}

function integerOption(
  args: ReturnType<typeof parseArgs>,
  key: string,
): number | undefined {
  const raw = optionalValue(args, key);
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) {
    throw new AechatError("invalid_input", `--${key} must be a positive integer`);
  }
  return value;
}

export async function sendCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const fromSession = requiredValue(args, "session");
  const toSession = targetFromArgs(args, ctx);
  const isRequest = args.flags.has("request");
  const kind: MessageKind = isRequest ? "request" : "notify";
  if (args.flags.has("deadline")) {
    throw new AechatError("invalid_input", "--deadline requires a value");
  }
  if (!isRequest && optionalValue(args, "deadline") !== undefined) {
    throw new AechatError("invalid_input", "--deadline is only valid with --request");
  }
  const deadlineSeconds = integerOption(args, "deadline");
  const dedupKey = optionalValue(args, "dedup-key");
  const ttlSeconds = integerOption(args, "ttl");

  const result = await ctx.delivery.send({
    fromSession,
    toSession,
    kind,
    body: bodyFromArgs(args),
    ...(dedupKey === undefined ? {} : { dedupKey }),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    ...(deadlineSeconds === undefined ? {} : { deadlineSeconds }),
  });

  return {
    message_id: result.messageId,
    delivery_id: result.deliveryId,
    to_session: toSession,
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}
