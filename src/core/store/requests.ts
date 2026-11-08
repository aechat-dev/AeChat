import type { DatabaseSync } from "node:sqlite";

export type RequestStatus = "open" | "replied" | "expired" | "cancelled";
export type RequestCloseReason =
  | "replied"
  | "deadline"
  | "sender_cancel"
  | "target_left"
  | "requester_left";

export interface RequestRecord {
  requestId: string;
  requesterSession: string;
  targetSession: string;
  status: RequestStatus;
  closeReason: RequestCloseReason | null;
  deadline: string | null;
  replyMessageId: string | null;
  createdAt: string;
  statusChangedAt: string;
}

export interface InsertRequestInput {
  requestId: string;
  requesterSession: string;
  targetSession: string;
  deadline?: string | null;
  createdAt: string;
  statusChangedAt?: string;
}

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function requestFromRow(row: Row): RequestRecord {
  return {
    requestId: String(row["request_id"]),
    requesterSession: String(row["requester_session"]),
    targetSession: String(row["target_session"]),
    status: String(row["status"]) as RequestStatus,
    closeReason: nullableString(
      row["close_reason"],
    ) as RequestCloseReason | null,
    deadline: nullableString(row["deadline"]),
    replyMessageId: nullableString(row["reply_message_id"]),
    createdAt: String(row["created_at"]),
    statusChangedAt: String(row["status_changed_at"]),
  };
}

export class RequestRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insert(input: InsertRequestInput): RequestRecord {
    this.db
      .prepare(
        `INSERT INTO requests (
          request_id, requester_session, target_session, status, close_reason,
          deadline, reply_message_id, created_at, status_changed_at
        ) VALUES (?, ?, ?, 'open', NULL, ?, NULL, ?, ?)`,
      )
      .run(
        input.requestId,
        input.requesterSession,
        input.targetSession,
        input.deadline ?? null,
        input.createdAt,
        input.statusChangedAt ?? input.createdAt,
      );
    return this.get(input.requestId) as RequestRecord;
  }

  get(requestId: string): RequestRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM requests WHERE request_id = ?")
      .get(requestId) as Row | undefined;
    return row === undefined ? undefined : requestFromRow(row);
  }

  expireOverdue(requestId: string, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE requests
         SET status = 'expired', close_reason = 'deadline', status_changed_at = ?
         WHERE request_id = ? AND status = 'open'
           AND deadline IS NOT NULL AND deadline <= ?`,
      )
      .run(now, requestId, now);
    return Number(result.changes) > 0;
  }

  markReplied(requestId: string, replyMessageId: string, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE requests
         SET status = 'replied', close_reason = 'replied',
             reply_message_id = ?, status_changed_at = ?
         WHERE request_id = ? AND status = 'open'
           AND (deadline IS NULL OR deadline > ?)`,
      )
      .run(replyMessageId, now, requestId, now);
    return Number(result.changes) > 0;
  }

  markCancelled(
    requestId: string,
    requesterSession: string,
    now: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE requests
         SET status = 'cancelled', close_reason = 'sender_cancel',
             status_changed_at = ?
         WHERE request_id = ? AND requester_session = ? AND status = 'open'
           AND (deadline IS NULL OR deadline > ?)`,
      )
      .run(now, requestId, requesterSession, now);
    return Number(result.changes) > 0;
  }

  cancelForLeft(sessionId: string, now: string): number {
    const result = this.db
      .prepare(
        `UPDATE requests
         SET status = 'cancelled',
             close_reason = CASE
               WHEN requester_session = ? THEN 'requester_left'
               ELSE 'target_left'
             END,
             status_changed_at = ?
         WHERE status = 'open'
           AND (requester_session = ? OR target_session = ?)`,
      )
      .run(sessionId, now, sessionId, sessionId);
    return Number(result.changes);
  }
}
