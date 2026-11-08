import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { hostHookPaths } from "../../adapters/hosts/registry.js";
import { openDatabase } from "../../core/store/db.js";
import { parseArgs } from "../args.js";
import type { CommandContext } from "./context.js";

function homeDir(): string {
  return process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
}

function dbPath(): string {
  return process.env["AECHAT_DB"] ?? join(homeDir(), "aechat.db");
}

function checkedRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export async function doctorCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  parseArgs(argv);
  const home = homeDir();
  const databasePath = dbPath();

  let quickCheck: string | null = null;
  let writable = false;
  let mode: string | null = null;
  try {
    const db = openDatabase(databasePath);
    try {
      const row = db.prepare("PRAGMA quick_check").get() as
        | Record<string, unknown>
        | undefined;
      quickCheck = row === undefined ? null : String(Object.values(row)[0]);
      db.exec("BEGIN IMMEDIATE");
      db.exec("ROLLBACK");
      writable = true;
    } finally {
      db.close();
    }
    mode = `0${(statSync(databasePath).mode & 0o777).toString(8)}`;
  } catch {
    writable = false;
  }

  const logsDir = join(home, "logs");
  let logsExist = false;
  let logsWritable = false;
  try {
    accessSync(logsDir, constants.F_OK);
    logsExist = true;
    accessSync(logsDir, constants.W_OK);
    logsWritable = true;
  } catch {
    // leave both false
  }

  const hookPaths = hostHookPaths();
  const configuredHooks = hookPaths.filter((path) => {
    const text = checkedRead(path);
    return text !== null && /agmsg|aechat/i.test(text);
  });

  let agmsgVersion: string | null = null;
  let agmsgError: string | null = null;
  if (ctx.agmsgVersion !== undefined) {
    try {
      agmsgVersion = await ctx.agmsgVersion();
    } catch (error) {
      agmsgError = error instanceof Error ? error.message : String(error);
    }
  }

  const bindings = ctx.service.list({ includeLeft: true }).map((entry) => ({
    session_id: entry.sessionId,
    transport: entry.transport?.transport ?? null,
    address: entry.transport?.address ?? null,
    mode: entry.transport?.mode ?? null,
    binding_state: entry.transport?.state ?? null,
  }));

  return {
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    agmsg: {
      checked: ctx.agmsgVersion !== undefined,
      version: agmsgVersion,
      supported: agmsgVersion === null ? null : agmsgVersion === "1.7.1",
      ...(agmsgError === null ? {} : { error: agmsgError }),
    },
    database: {
      path: databasePath,
      writable,
      quick_check: quickCheck,
      mode,
    },
    logs: {
      path: logsDir,
      exists: logsExist,
      writable: logsWritable,
    },
    transport: {
      name: ctx.transport.name,
      bindings,
    },
    host_hook: {
      paths: hookPaths,
      configured: configuredHooks,
    },
  };
}
