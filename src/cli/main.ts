#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AechatError } from "../core/errors.js";
import { resolveTransport } from "../runtime/options.js";
import { createReadOnlyRuntime } from "../runtime/read-only-runtime.js";
import { createRuntime } from "../runtime/runtime.js";
import { UiQueryService } from "../runtime/ui-query-service.js";
import { ackCommand } from "./commands/ack.js";
import { cancelCommand } from "./commands/cancel.js";
import { confirmCommand } from "./commands/confirm.js";
import { doctorCommand } from "./commands/doctor.js";
import { heartbeatCommand } from "./commands/heartbeat.js";
import { historyCommand } from "./commands/history.js";
import { inboxCommand } from "./commands/inbox.js";
import { initCommand } from "./commands/init.js";
import { leaveCommand } from "./commands/leave.js";
import { listCommand } from "./commands/list.js";
import { logCommand } from "./commands/log.js";
import { probeCommand } from "./commands/probe.js";
import { receiveCommand } from "./commands/receive.js";
import { registerCommand } from "./commands/register.js";
import { replyCommand } from "./commands/reply.js";
import { resumeCommand } from "./commands/resume.js";
import { retryCommand } from "./commands/retry.js";
import { sendCommand } from "./commands/send.js";
import { setupCommand } from "./commands/setup.js";
import { showCommand } from "./commands/show.js";
import { uiDoctorCommand } from "./commands/ui-doctor.js";
import { uiEventsCommand } from "./commands/ui-events.js";
import { uiLogCommand } from "./commands/ui-log.js";
import { uiMessagesCommand } from "./commands/ui-messages.js";
import { uiSnapshotCommand } from "./commands/ui-snapshot.js";
import { waitCommand } from "./commands/wait.js";
import { watchCommand } from "./commands/watch.js";
import { whoamiCommand } from "./commands/whoami.js";
import { errorEnvelope, isCommandResult, render } from "./output.js";

const UI_COMMANDS = new Set([
  "ui-snapshot",
  "ui-messages",
  "ui-log",
  "ui-events",
  "ui-doctor",
]);

const COMMANDS = new Set([
  "register",
  "confirm",
  "whoami",
  "list",
  "heartbeat",
  "probe",
  "send",
  "inbox",
  "watch",
  "receive",
  "ack",
  "show",
  "reply",
  "wait",
  "cancel",
  "retry",
  "doctor",
  "init",
  "setup",
  "resume",
  "leave",
  "history",
  "log",
  ...UI_COMMANDS,
]);

const USAGE = `aechat — local-first session messaging

Usage: aechat <command> [options]

Commands:
  register   --name <display> --client <host|other> [--project <path>] [--no-bind]
  confirm    --session <uuid>
  whoami     --session <uuid> | --conversation <id>
  list       [--json] [--all] [--as <session>]
  heartbeat  --session <uuid>
  probe      --session <uuid>
  send       --session <uuid> (--to-session <uuid> | --to-name <name>)
             (--body <text> | --body-file <path>) [--request] [--deadline <seconds>]
             [--dedup-key <key>] [--ttl <seconds>]
  inbox      --session <uuid> [--peek] [--json] [--limit <n>]
  watch      --session <uuid> [--interval <seconds>] [--limit <n>] [--once]
  receive    --session <uuid> [--timeout <seconds>] [--json]
  ack        --session <uuid> --delivery <token>
  show       --session <uuid> --message <message-id> [--json]
  reply      --session <uuid> --request <request-id> (--body <text> | --body-file <path>)
  wait       --session <uuid> [--request <request-id>] [--timeout <seconds>] [--peek] [--json]
  cancel     --session <uuid> --request <request-id>
  retry      --session <uuid> (--message <message-id> | --delivery <delivery-id>)
  doctor     [--json]
  init       [--json] [--dry-run]
  setup      <host> [--hooks] [--project <path>] [--json] [--dry-run]
  resume     --session <uuid> [--force]
  leave      --session <uuid>
  history    --session <uuid> [--limit <n>] [--json]
  log        --message <message-id> [--delivery <id>] [--as <session>] [--json]
  ui-snapshot
  ui-messages --session <uuid> [--counterpart <uuid>] [--before <cursor>] [--limit <n>] [--json]
  ui-log     --message <message-id> [--delivery <id>] [--json]
  ui-events  --after <seq> [--jsonl]
  ui-doctor  [--json]

All identity-related commands require an explicit session.
`;

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
    if (UI_COMMANDS.has(command)) {
      const runtime = createReadOnlyRuntime();
      try {
        const uiCtx = { runtime, ui: new UiQueryService(runtime) };
        if (command === "ui-events") {
          await uiEventsCommand(rest, uiCtx);
          return 0;
        }
        let data: unknown;
        switch (command) {
          case "ui-snapshot":
            data = await uiSnapshotCommand(rest, uiCtx);
            break;
          case "ui-messages":
            data = uiMessagesCommand(rest, uiCtx);
            break;
          case "ui-log":
            data = uiLogCommand(rest, uiCtx);
            break;
          case "ui-doctor":
            data = await uiDoctorCommand(rest, uiCtx);
            break;
          default:
            throw new AechatError(
              "internal",
              `unhandled ui command: ${command}`,
            );
        }
        render(data);
        return isCommandResult(data) ? (data.exitCode ?? 0) : 0;
      } finally {
        runtime.close();
      }
    }
    // Bootstrap commands must not open the store: `--dry-run` is defined as
    // no side effects, and a plain `setup` should not create a database.
    if (command === "init" || command === "setup") {
      const { agmsgVersion } = resolveTransport();
      const data =
        command === "init"
          ? await initCommand(
              rest,
              agmsgVersion === undefined ? {} : { agmsgVersion },
            )
          : await setupCommand(rest);
      render(data);
      return isCommandResult(data) ? (data.exitCode ?? 0) : 0;
    }

    const ctx = createRuntime();
    try {
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
        case "probe":
          data = await probeCommand(rest, ctx);
          break;
        case "send":
          data = await sendCommand(rest, ctx);
          break;
        case "inbox":
          data = await inboxCommand(rest, ctx);
          break;
        case "receive":
          data = await receiveCommand(rest, ctx);
          break;
        case "watch":
          data = await watchCommand(rest, ctx);
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
        case "history":
          data = historyCommand(rest, ctx);
          break;
        case "log":
          data = logCommand(rest, ctx);
          break;
        default:
          throw new AechatError("internal", `unhandled command: ${command}`);
      }
      render(data);
      return isCommandResult(data) ? (data.exitCode ?? 0) : 0;
    } finally {
      ctx.close();
    }
  } catch (error) {
    if (error instanceof AechatError) {
      errorEnvelope(error.code, error.message, error.details);
      return error.exitCode;
    }
    errorEnvelope(
      "internal",
      error instanceof Error ? error.message : String(error),
    );
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
  const streaming = process.argv[2] === "ui-events";
  void main(process.argv.slice(2)).then((code) => {
    if (streaming) {
      // A long-lived stream may still have buffered bytes in a pipe the app
      // stopped reading. Exit explicitly after cleanup so the process cannot
      // hang in the stdio flush at shutdown.
      process.exit(code);
    }
    process.exitCode = code;
  });
}
