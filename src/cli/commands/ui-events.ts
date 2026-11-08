import { AechatError } from "../../core/errors.js";
import { uiEventStream } from "../../runtime/ui-event-stream.js";
import { parseArgs, requiredValue } from "../args.js";
import type { UiCommandContext } from "./ui-context.js";

/**
 * Write one JSONL line, resolving false when the stream is aborted while
 * waiting for the pipe to drain. Without the abort race, an app that stops
 * reading stdout would keep the process alive after SIGTERM.
 */
function writeLine(line: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }
  if (process.stdout.write(line)) {
    return Promise.resolve(true);
  }
  return new Promise<boolean>((resolve) => {
    const onDrain = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    };
    const onAbort = (): void => {
      process.stdout.removeListener("drain", onDrain);
      resolve(false);
    };
    process.stdout.once("drain", onDrain);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Long-lived JSONL stream. It bypasses the normal render path and never calls
 * inbox/wait/ack; the app terminates the process on quit.
 */
export async function uiEventsCommand(
  argv: readonly string[],
  ctx: UiCommandContext,
): Promise<void> {
  const args = parseArgs(argv);
  const after = Number(requiredValue(args, "after"));
  if (!Number.isInteger(after) || after < 0) {
    throw new AechatError(
      "invalid_input",
      "--after must be a non-negative integer",
    );
  }

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    for await (const item of uiEventStream(ctx.ui, ctx.runtime.now, {
      after,
      signal: controller.signal,
    })) {
      if (!(await writeLine(`${JSON.stringify(item)}\n`, controller.signal))) {
        break;
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (controller.signal.aborted && process.stdout.isTTY !== true) {
      // Release a blocked pipe so the process can exit after the app quits.
      process.stdout.destroy();
    }
  }
}
