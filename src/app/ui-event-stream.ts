import { setTimeout as delay } from "node:timers/promises";

import type { UiQueryService } from "./ui-query-service.js";
import type { UiEvent, UiEventTick } from "../contracts/ui.js";

export interface UiEventStreamOptions {
  after: number;
  signal?: AbortSignal;
  pollMs?: number;
  tickMs?: number;
  limit?: number;
}

export type UiEventStreamItem = UiEvent | UiEventTick;

/**
 * Incremental event stream for `ui-events`. The 2s snapshot tick covers
 * state changes that have no per-message event (expire/dead_letter/
 * cancelForLeft), so the app can reconcile instead of trusting the stream as
 * a complete change log.
 */
export async function* uiEventStream(
  deps: Pick<UiQueryService, "events">,
  now: () => string,
  options: UiEventStreamOptions,
): AsyncGenerator<UiEventStreamItem> {
  const pollMs = options.pollMs ?? 250;
  const tickMs = options.tickMs ?? 2000;
  const limit = options.limit ?? 200;
  const signal = options.signal;
  const aborted = (): boolean => signal?.aborted === true;
  let cursor = options.after;
  let lastTick = Date.now();

  for (;;) {
    if (aborted()) {
      return;
    }
    const batch = deps.events(cursor, limit);
    for (const event of batch) {
      if (aborted()) {
        return;
      }
      cursor = event.seq;
      yield event;
    }

    const nowMs = Date.now();
    if (nowMs - lastTick >= tickMs) {
      lastTick = nowMs;
      yield { kind: "snapshot", generated_at: now() };
    }

    // Rate-limit bursts to one poll window so a busy database cannot flood
    // the app's JSONL reader or force a redraw per event.
    try {
      await delay(
        pollMs,
        undefined,
        signal === undefined ? {} : { signal },
      );
    } catch {
      return;
    }
  }
}
