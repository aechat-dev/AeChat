#!/usr/bin/env node
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AgmsgAdapter } from "../adapters/transport/agmsg/agmsg-adapter.js";
import { AgmsgCli } from "../adapters/transport/agmsg/agmsg-cli.js";
import { confirmCommand } from "./commands/confirm.js";
import type { CommandContext } from "./commands/context.js";
import { heartbeatCommand } from "./commands/heartbeat.js";
import { listCommand } from "./commands/list.js";
import { registerCommand } from "./commands/register.js";
import { whoamiCommand } from "./commands/whoami.js";
import { AechatError } from "../core/errors.js";
import { SessionService } from "../core/services/session-service.js";
import { openDatabase } from "../core/store/db.js";
import { EventRepository } from "../core/store/events.js";
import { migrate } from "../core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../core/store/sessions.js";
import { nowIso } from "../core/time.js";
import { errorEnvelope, ok } from "./output.js";

const COMMANDS = new Set([
  "register",
  "confirm",
  "whoami",
  "list",
  "heartbeat",
]);

const USAGE = `aechat — local-first session messaging

Usage: aechat <command> [options]

Commands:
  register   --name <display> --client <claude-code|codex|other> [--project <path>]
  confirm    --session <uuid>
  whoami     --session <uuid> | --conversation <id>
  list       [--json] [--all]
  heartbeat  --session <uuid>

All identity-related commands require an explicit session.
`;

function createContext(): CommandContext {
  const home = process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const db = openDatabase(process.env["AECHAT_DB"] ?? join(home, "aechat.db"));
  migrate(db);

  const transport = new AgmsgAdapter({
    cli: new AgmsgCli(),
    team: process.env["AECHAT_TEAM"] ?? "aechat",
  });
  const service = new SessionService({
    sessions: new SessionRepository(db),
    bindings: new TransportBindingRepository(db),
    transport,
    events: new EventRepository(db),
  });

  return { service, transport, now: nowIso };
}

/**
 * CLI entry point. Returns the process exit code instead of calling
 * `process.exit`, so tests can invoke it without terminating the runner.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  try {
    if (!COMMANDS.has(command)) {
      throw new AechatError("invalid_input", `unknown command: ${command}`);
    }
    const ctx = createContext();
    let data: unknown;
    switch (command) {
      case "register":
        data = await registerCommand(rest, ctx);
        break;
      case "confirm":
        data = await confirmCommand(rest, ctx);
        break;
      case "whoami":
        data = whoamiCommand(rest, ctx);
        break;
      case "list":
        data = await listCommand(rest, ctx);
        break;
      case "heartbeat":
        data = heartbeatCommand(rest, ctx);
        break;
      default:
        throw new AechatError("internal", `unhandled command: ${command}`);
    }
    ok(data);
    return 0;
  } catch (error) {
    if (error instanceof AechatError) {
      errorEnvelope(error.code, error.message, error.details);
      return error.exitCode;
    }
    errorEnvelope("internal", error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function isEntryPoint(
  argv1: string | undefined,
  moduleUrl: string,
): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
