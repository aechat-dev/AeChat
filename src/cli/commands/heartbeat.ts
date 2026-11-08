import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AechatError } from "../../core/errors.js";
import { optionalValue, parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

export function heartbeatPidPath(
  sessionId: string,
  home = process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat"),
): string {
  return join(home, "run", `${sessionId}.heartbeat.pid`);
}

function acquirePidFile(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  try {
    const existing = readFileSync(path, "utf8").trim();
    const pid = Number(existing);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        throw new AechatError(
          "invalid_input",
          `heartbeat already running for this session (pid ${pid})`,
        );
      } catch (error) {
        if (error instanceof AechatError) {
          throw error;
        }
        // Stale pid file: the process is gone.
      }
    }
  } catch (error) {
    if (error instanceof AechatError) {
      throw error;
    }
    if ((error as { code?: string }).code !== "ENOENT") {
      throw error;
    }
  }
  writeFileSync(path, `${process.pid}\n`, { mode: 0o600 });
}

function heartbeatDto(session: {
  sessionId: string;
  lastSeenAt: string;
  hostSeenAt: string | null;
}): Record<string, unknown> {
  return {
    session_id: session.sessionId,
    last_seen_at: session.lastSeenAt,
    host_seen_at: session.hostSeenAt,
  };
}

export async function heartbeatCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new AechatError("invalid_input", "invalid session id for heartbeat");
  }
  const intervalRaw = optionalValue(args, "interval");
  if (args.flags.has("interval")) {
    throw new AechatError("invalid_input", "--interval requires a value");
  }
  if (intervalRaw === undefined) {
    ctx.service.heartbeat(sessionId, ctx.now());
    return heartbeatDto(ctx.service.whoami({ sessionId }));
  }

  const interval = Number(intervalRaw.trim());
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new AechatError("invalid_input", "--interval must be positive");
  }

  const pidPath = heartbeatPidPath(sessionId);
  acquirePidFile(pidPath);
  try {
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const cleanup = (): void => {
        if (timer !== undefined) {
          clearInterval(timer);
        }
        process.off("SIGTERM", stop);
        process.off("SIGINT", stop);
        rmSync(pidPath, { force: true });
      };
      const stop = (): void => {
        cleanup();
        resolve();
      };
      const fail = (error: unknown): void => {
        cleanup();
        reject(error);
      };
      const tick = (): void => {
        try {
          ctx.service.heartbeat(sessionId, ctx.now());
        } catch (error) {
          fail(error);
        }
      };
      timer = setInterval(tick, interval * 1000);
      tick();
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
  } finally {
    rmSync(pidPath, { force: true });
  }
  return heartbeatDto(ctx.service.whoami({ sessionId }));
}
