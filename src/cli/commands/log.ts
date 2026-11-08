import type { AuditLogEntry } from "../../core/services/audit-service.js";
import { parseArgs, requiredValue } from "../args.js";
import { formatBody } from "../message-format.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

function logDto(entry: AuditLogEntry): Record<string, unknown> {
  return {
    message_id: entry.messageId,
    kind: entry.kind,
    from_session: entry.fromSession,
    to_session: entry.toSession,
    request_id: entry.requestId,
    delivery_id: entry.deliveryId,
    delivery_status: entry.deliveryStatus,
    attempts: entry.attempts,
    last_error: entry.lastError,
    request_status: entry.requestStatus,
    reply_message_id: entry.replyMessageId,
    chain: entry.chain.map((event) => ({
      event: event.event,
      stage: event.stage,
      ts: event.ts,
      level: event.level,
      session_id: event.sessionId,
      delivery_id: event.deliveryId,
      request_id: event.requestId,
      error_code: event.errorCode,
      error_detail: event.errorDetail,
      data: event.data,
    })),
  };
}

function formatLogText(entry: AuditLogEntry): string {
  const lines = [
    `message: ${entry.messageId}`,
    `kind: ${entry.kind}`,
    `from-session: ${entry.fromSession}`,
    `to-session: ${entry.toSession}`,
    `delivery: ${entry.deliveryId ?? "-"} status=${entry.deliveryStatus ?? "-"} attempts=${entry.attempts ?? "-"}`,
    `request-status: ${entry.requestStatus ?? "-"}`,
    `reply-message: ${entry.replyMessageId ?? "-"}`,
    "chain:",
  ];
  for (const event of entry.chain) {
    const error =
      event.errorDetail === null
        ? ""
        : ` error=${formatBody(event.errorDetail)}`;
    lines.push(
      `  ${event.ts} ${event.level} ${event.stage} session=${event.sessionId ?? "-"} delivery=${event.deliveryId ?? "-"}${error}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function logCommand(
  argv: readonly string[],
  ctx: CommandContext,
): CommandResult {
  const args = parseArgs(argv);
  const messageId = requiredValue(args, "message");
  const deliveryId = args.values.get("delivery");
  const asSession = args.values.get("as");
  const entry = ctx.audit.log({
    messageId,
    ...(deliveryId === undefined ? {} : { deliveryId }),
    ...(asSession === undefined ? {} : { asSession }),
  });
  const data = logDto(entry);
  return args.flags.has("json")
    ? { data }
    : { data, text: formatLogText(entry) };
}
