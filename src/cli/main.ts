#!/usr/bin/env node
import { mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { AgmsgAdapter } from "../adapters/transport/agmsg/agmsg-adapter.js";
import { AgmsgCli } from "../adapters/transport/agmsg/agmsg-cli.js";
import { ackCommand } from "./commands/ack.js";
import { cancelCommand } from "./commands/cancel.js";
import { confirmCommand } from "./commands/confirm.js";
import { doctorCommand } from "./commands/doctor.js";
import type { CommandContext } from "./commands/context.js";
import { heartbeatCommand } from "./commands/heartbeat.js";
import { inboxCommand } from "./commands/inbox.js";
import { leaveCommand } from "./commands/leave.js";
import { listCommand } from "./commands/list.js";
import { registerCommand } from "./commands/register.js";
import { resumeCommand } from "./commands/resume.js";
import { replyCommand } from "./commands/reply.js";
import { retryCommand } from "./commands/retry.js";
import { sendCommand } from "./commands/send.js";
import { showCommand } from "./commands/show.js";
import { waitCommand } from "./commands/wait.js";
import { whoamiCommand } from "./commands/whoami.js";
import { AechatError } from "../core/errors.js";
import { DeliveryService } from "../core/services/delivery-service.js";
import { CapabilityService } from "../core/services/capability-service.js";
import { RequestService } from "../core/services/request-service.js";
import { ResumeService } from "../core/services/resume-service.js";
import { SessionService } from "../core/services/session-service.js";
import { openDatabase } from "../core/store/db.js";
import { EventRepository } from "../core/store/events.js";
import { MessageRepository, DeliveryRepository } from "../core/store/messages.js";
import { ProbeRepository } from "../core/store/probes.js";
import { RequestRepository } from "../core/store/requests.js";
import { migrate } from "../core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../core/store/sessions.js";
import { nowIso } from "../core/time.js";
import { errorEnvelope, isCommandResult, render } from "./output.js";

const COMMANDS = new Set([
  "register",
  "confirm",
  "whoami",
  "list",
  "heartbeat",
  "send",
  "inbox",
  "ack",
  "show",
  "reply",
  "wait",
  "cancel",
  "retry",
  "doctor",
  "resume",
  "leave",
]);

const USAGE = `aechat — local-first session messaging

Usage: aechat <command> [options]

Commands:
  register   --name <display> --client <claude-code|codex|other> [--project <path>]
  confirm    --session <uuid>
  whoami     --session <uuid> | --conversation <id>
  list       [--json] [--all]
  heartbeat  --session <uuid>
  send       --session <uuid> (--to-session <uuid> | --to-name <name>)
             (--body <text> | --body-file <path>) [--request] [--deadline <seconds>]
             [--dedup-key <key>] [--ttl <seconds>]
  inbox      --session <uuid> [--peek] [--json] [--limit <n>]
  ack        --session <uuid> --delivery <token>
  show       --session <uuid> --message <message-id> [--json]
  reply      --session <uuid> --request <request-id> (--body <text> | --body-file <path>)
  wait       --session <uuid> [--request <request-id>] [--timeout <seconds>] [--peek] [--json]
  cancel     --session <uuid> --request <request-id>
  retry      --session <uuid> (--message <message-id> | --delivery <delivery-id>)
  doctor     [--json]
  resume     --session <uuid> [--force]
  leave      --session <uuid>

All identity-related commands require an explicit session.
`;

function createContext(): CommandContext {
  const home = process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const db = openDatabase(process.env["AECHAT_DB"] ?? join(home, "aechat.db"));
  migrate(db);

  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const events = new EventRepository(db);
  const agmsgCli = new AgmsgCli();
  const transport = new AgmsgAdapter({
    cli: agmsgCli,
    team: process.env["AECHAT_TEAM"] ?? "aechat",
  });
  const service = new SessionService({
    sessions,
    bindings,
    transport,
    requests: new RequestRepository(db),
    db,
    events,
  });
  const delivery = new DeliveryService({
    db,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    sessions,
    bindings,
    transport,
    events,
  });
  const request = new RequestService({
    db,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    delivery,
    events,
  });
  const capabilities = new CapabilityService({
    sessions,
    bindings,
    probes: new ProbeRepository(db),
    transport,
  });
  const resume = new ResumeService({
    db,
    sessions,
    bindings,
    deliveries: new DeliveryRepository(db),
    transport,
    events,
  });

  return {
    service,
    delivery,
    request,
    resume,
    capabilities,
    transport,
    now: nowIso,
    agmsgVersion: () => agmsgCli.version(),
  };
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
        data = await heartbeatCommand(rest, ctx);
        break;
      case "send":
        data = await sendCommand(rest, ctx);
        break;
      case "inbox":
        data = await inboxCommand(rest, ctx);
        break;
      case "ack":
        data = ackCommand(rest, ctx);
        break;
      case "show":
        data = showCommand(rest, ctx);
        break;
      case "reply":
        data = await replyCommand(rest, ctx);
        break;
      case "wait":
        data = await waitCommand(rest, ctx);
        break;
      case "cancel":
        data = cancelCommand(rest, ctx);
        break;
      case "retry":
        data = await retryCommand(rest, ctx);
        break;
      case "doctor":
        data = await doctorCommand(rest, ctx);
        break;
      case "resume":
        data = await resumeCommand(rest, ctx);
        break;
      case "leave":
        data = await leaveCommand(rest, ctx);
        break;
      default:
        throw new AechatError("internal", `unhandled command: ${command}`);
    }
    render(data);
    return isCommandResult(data) ? (data.exitCode ?? 0) : 0;
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
