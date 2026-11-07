import type { DatabaseSync } from "node:sqlite";

import { redactErrorDetail } from "../log-redaction.js";
import { newId } from "../ids.js";
import { nowIso } from "../time.js";

export interface RecordEventInput {
  event: string;
  level?: "info" | "warn" | "error";
  sessionId?: string | null;
  messageId?: string | null;
  deliveryId?: string | null;
  requestId?: string | null;
  transport?: string | null;
  mode?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  errorCode?: string | null;
  errorDetail?: string | null;
  data?: Record<string, unknown>;
  eventId?: string;
  ts?: string;
}

export interface EventRecord {
  seq: number;
  eventId: string;
  ts: string;
  level: string;
  event: string;
  sessionId: string | null;
  messageId: string | null;
  deliveryId: string | null;
  requestId: string | null;
  transport: string | null;
  mode: string | null;
  exitCode: number | null;
  durationMs: number | null;
  errorCode: string | null;
  errorDetail: string | null;
  dataJson: string | null;
}

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function eventFromRow(row: Row): EventRecord {
  return {
    seq: Number(row["seq"]),
    eventId: String(row["event_id"]),
    ts: String(row["ts"]),
    level: String(row["level"]),
    event: String(row["event"]),
    sessionId: nullableString(row["session_id"]),
    messageId: nullableString(row["message_id"]),
    deliveryId: nullableString(row["delivery_id"]),
    requestId: nullableString(row["request_id"]),
    transport: nullableString(row["transport"]),
    mode: nullableString(row["mode"]),
    exitCode: row["exit_code"] === null ? null : Number(row["exit_code"]),
    durationMs: row["duration_ms"] === null ? null : Number(row["duration_ms"]),
    errorCode: nullableString(row["error_code"]),
    errorDetail: redactErrorDetail(nullableString(row["error_detail"])),
    dataJson: nullableString(row["data_json"]),
  };
}

/**
 * Append-only audit trail. The events table is the source of truth; callers
 * must not update or delete rows to hide a state transition.
 */
export class EventRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(input: RecordEventInput): string {
    const eventId = input.eventId ?? newId();
    this.db
      .prepare(
        `INSERT INTO events (
          event_id, ts, level, event, session_id, message_id, delivery_id,
          request_id, transport, mode, exit_code, duration_ms, error_code,
          error_detail, data_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eventId,
        input.ts ?? nowIso(),
        input.level ?? "info",
        input.event,
        input.sessionId ?? null,
        input.messageId ?? null,
        input.deliveryId ?? null,
        input.requestId ?? null,
        input.transport ?? null,
        input.mode ?? null,
        input.exitCode ?? null,
        input.durationMs ?? null,
        input.errorCode ?? null,
        redactErrorDetail(input.errorDetail ?? null),
        input.data === undefined ? null : JSON.stringify(input.data),
      );
    return eventId;
  }

  listForSession(sessionId: string): EventRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY seq")
      .all(sessionId) as Row[];
    return rows.map(eventFromRow);
  }

  /** Latest committed seq, or 0 for an empty log. */
  latestSeq(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM events")
      .get() as Row | undefined;
    return Number(row?.["seq"] ?? 0);
  }

  listAfter(after: number, limit = 200): EventRecord[] {
    if (!Number.isInteger(after) || after < 0) {
      throw new Error("event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("event limit must be a positive integer");
    }
    const rows = this.db
      .prepare(
        "SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
      )
      .all(after, limit) as Row[];
    return rows.map(eventFromRow);
  }

  /**
   * Audit chain for one message. A reply event stores the reply message id and
   * the original request id, so matching request_id keeps the whole exchange
   * visible from either message without joining a separate table.
   */
  listForMessage(
    messageId: string,
    deliveryId?: string,
    requestId: string = messageId,
  ): EventRecord[] {
    const rows = (
      deliveryId === undefined
        ? this.db
            .prepare(
              `SELECT * FROM events
               WHERE message_id = ? OR message_id = ? OR request_id = ?
               ORDER BY seq`,
            )
            .all(messageId, requestId, requestId)
        : this.db
            .prepare(
              `SELECT * FROM events
               WHERE (message_id = ? OR message_id = ? OR request_id = ?)
                 AND delivery_id = ?
               ORDER BY seq`,
            )
            .all(messageId, requestId, requestId, deliveryId)
    ) as Row[];
    return rows.map(eventFromRow);
  }
}
