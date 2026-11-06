import { readFileSync } from "node:fs";

import { AechatError } from "../../core/errors.js";
import type { MessageKind } from "../../core/store/messages.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

function bodyFromArgs(args: ReturnType<typeof parseArgs>): string {
  const body = optionalValue(args, "body");
  const bodyFile = optionalValue(args, "body-file");
  if ((body === undefined) === (bodyFile === undefined)) {
    throw new AechatError(
      "invalid_input",
      "send requires exactly one of --body or --body-file",
    );
  }
  if (body !== undefined) {
    return body;
  }
  try {
    return readFileSync(bodyFile as string, "utf8");
  } catch (error) {
    throw new AechatError("invalid_input", `cannot read --body-file: ${bodyFile}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

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
  if (optionalValue(args, "deadline") !== undefined || args.flags.has("deadline")) {
    throw new AechatError(
      "invalid_input",
      "--deadline is only valid with --request (not implemented yet)",
    );
  }
  const toSession = targetFromArgs(args, ctx);
  const kind: MessageKind = args.flags.has("request") ? "request" : "notify";
  const dedupKey = optionalValue(args, "dedup-key");
  const ttlSeconds = integerOption(args, "ttl");

  const result = await ctx.delivery.send({
    fromSession,
    toSession,
    kind,
    body: bodyFromArgs(args),
    ...(dedupKey === undefined ? {} : { dedupKey }),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
  });

  return {
    message_id: result.messageId,
    delivery_id: result.deliveryId,
    to_session: toSession,
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}
