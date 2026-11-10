import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AechatError } from "../core/errors.js";

const LOCK_TTL_MS = 60_000;
// Keep this below the plugin wrapper's 30s spawn timeout so a waiter that wins
// the lock still has time to run attach.
const LOCK_WAIT_MS = 20_000;
const RETRY_MS = 50;

function lockPath(home: string, conversationId: string): string {
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return join(home, "locks", `attach-${safe}.lock`);
}

/**
 * Serialize attach for one host conversation across processes. Two SessionStart
 * hooks can fire together (for example on a desktop restart); without this,
 * both can miss the existing row and register a duplicate session.
 *
 * The lock file holds a unique token. A waiter reclaims a stale lock by
 * renaming it to a private path (atomic, so only one waiter wins) and only
 * unlinks the file if its own token is still there, so a reclaimed holder can
 * never delete its successor's lock.
 */
export async function withAttachLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
  options: { home?: string; now?: () => number } = {},
): Promise<T> {
  const home =
    options.home ?? process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
  const now = options.now ?? Date.now;
  const path = lockPath(home, conversationId);
  mkdirSync(join(home, "locks"), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;

  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, token);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        if (now() - statSync(path).mtimeMs > LOCK_TTL_MS) {
          const stale = `${path}.stale-${randomUUID()}`;
          renameSync(path, stale);
          // Only remove it after the rename; if a fresh holder appeared between
          // the stat and the rename, put its lock back and keep waiting.
          if (now() - statSync(stale).mtimeMs > LOCK_TTL_MS) {
            unlinkSync(stale);
          } else {
            renameSync(stale, path);
          }
          continue;
        }
      } catch {
        // The holder released (or another waiter reclaimed) between calls.
      }
      if (now() > deadline) {
        throw new AechatError(
          "transport_unavailable",
          `timed out waiting for attach lock: ${path}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      if (readFileSync(path, "utf8") === token) {
        unlinkSync(path);
      }
    } catch {
      // Already gone or reclaimed; never mask the attach result.
    }
  }
}
