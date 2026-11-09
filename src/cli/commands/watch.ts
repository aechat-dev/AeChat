import { AechatError } from "../../core/errors.js";
import type { InboxItem } from "../../core/services/delivery-service.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import { inboxItemDto } from "../message-dto.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

const DEFAULT_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 300;
const MAX_LIMIT = 100;

function numberOption(
  args: ReturnType<typeof parseArgs>,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = optionalValue(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new AechatError(
      "invalid_input",
      `--${name} must be an integer in 1..${max}`,
    );
  }
  return value;
}

/**
 * Emit messages that have not been shown yet, without claiming them.
 * Claiming happens later through `receive`/`inbox`, so a slow consumer does
 * not lose a delivery to an expired lease while the event is being handled.
 */
export async function watchOnce(
  ctx: CommandContext,
  sessionId: string,
  limit: number,
  seen: Set<string>,
): Promise<InboxItem[]> {
  const items = await ctx.delivery.inbox({ sessionId, limit, peek: true });
  const fresh: InboxItem[] = [];
  for (const item of items) {
    const id = item.message.messageId;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    fresh.push(item);
  }
  return fresh;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function watchCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<CommandResult> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  const interval = numberOption(
    args,
    "interval",
    DEFAULT_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS,
  );
  // Peek has no cursor, so this is the visible backlog window. A consumer
  // must claim entries to let later messages into the window.
  const limit = numberOption(args, "limit", MAX_LIMIT, MAX_LIMIT);
  const once = args.flags.has("once");
  const seen = new Set<string>();
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let emitted = 0;
  try {
    do {
      const fresh = await watchOnce(ctx, sessionId, limit, seen);
      for (const item of fresh) {
        emitted += 1;
        process.stdout.write(
          `${JSON.stringify({ event: "aechat_message", ...inboxItemDto(item) })}\n`,
        );
      }
      if (once) {
        break;
      }
      await sleep(interval * 1000);
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  return { data: { watched: true, emitted } };
}
