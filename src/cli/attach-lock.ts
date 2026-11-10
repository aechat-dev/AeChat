import {
  closeSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AechatError } from "../core/errors.js";

const LOCK_TTL_MS = 60_000;
const LOCK_WAIT_MS = 30_000;
const RETRY_MS = 50;

function lockPath(home: string, conversationId: string): string {
  const safe = conversationId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(home, "locks", `attach-${safe}.lock`);
}

/**
 * Serialize attach for one host conversation across processes. Two SessionStart
 * hooks can fire together (for example on a desktop restart); without this,
 * both can miss the existing row and register a duplicate session.
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

  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      try {
        if (now() - statSync(path).mtimeMs > LOCK_TTL_MS) {
          unlinkSync(path);
          continue;
        }
      } catch {
        // The holder released between the failed open and the stat: retry.
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
      unlinkSync(path);
    } catch {
      // Already gone; never mask the attach result.
    }
  }
}
