import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { resolvePaths } from "../../app/options.js";
import { parseArgs } from "../args.js";
import type { UiCommandContext } from "./ui-context.js";

function fileMode(path: string): string | null {
  try {
    return `0${(statSync(path).mode & 0o777).toString(8)}`;
  } catch {
    return null;
  }
}

function checkedRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read-only environment facts. Unlike `doctor`, it never opens a writable
 * connection, never migrates and never chmods the store.
 */
export async function uiDoctorCommand(
  argv: readonly string[],
  ctx: UiCommandContext,
): Promise<Record<string, unknown>> {
  parseArgs(argv);
  const { home, dbPath } = resolvePaths();

  const quickCheck = ctx.runtime.db.prepare("PRAGMA quick_check").get() as
    | Record<string, unknown>
    | undefined;
  const version = ctx.runtime.db.prepare("PRAGMA user_version").get() as
    | Record<string, unknown>
    | undefined;

  const sessions = ctx.runtime.sessions.list({ includeLeft: true });
  const bindingRows = sessions.flatMap((session) =>
    ctx.runtime.bindings.listForSession(session.sessionId).map((binding) => ({
      session_id: session.sessionId,
      transport: binding.transport,
      address: binding.address,
      mode: binding.mode,
      state: binding.state,
    })),
  );

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

  const hookPaths = [
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".codex", "config.toml"),
  ];
  const configuredHooks = hookPaths.filter((path) => {
    const text = checkedRead(path);
    return text !== null && /agmsg|aechat/i.test(text);
  });

  let agmsgVersion: string | null = null;
  let agmsgError: string | null = null;
  if (ctx.runtime.agmsgVersion !== undefined) {
    try {
      agmsgVersion = await ctx.runtime.agmsgVersion();
    } catch (error) {
      agmsgError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    node: {
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    agmsg: {
      checked: ctx.runtime.agmsgVersion !== undefined,
      version: agmsgVersion,
      supported: agmsgVersion === null ? null : agmsgVersion === "1.7.1",
      ...(agmsgError === null ? {} : { error: agmsgError }),
    },
    database: {
      path: dbPath,
      read_only: true,
      schema_version:
        version === undefined ? null : Number(version["user_version"]),
      quick_check:
        quickCheck === undefined ? null : String(Object.values(quickCheck)[0]),
      mode: fileMode(dbPath),
    },
    logs: {
      path: logsDir,
      exists: logsExist,
      writable: logsWritable,
      mode: fileMode(logsDir),
    },
    config: {
      home,
      db_path: dbPath,
      team: process.env["AECHAT_TEAM"] ?? "aechat",
    },
    transport: {
      name: ctx.runtime.transport.name,
      bindings: bindingRows.length,
      details: bindingRows,
    },
    host_hook: {
      paths: hookPaths,
      configured: configuredHooks,
    },
  };
}
