import type { DatabaseSync } from "node:sqlite";

import { redactErrorDetail } from "../log-redaction.js";
import { newId } from "../ids.js";
import { withImmediate } from "./db.js";

export type MessageKind = "notify" | "request" | "reply";
export type DeliveryStatus =
  | "stored"
  | "notified"
  | "delivered"
  | "acked"
  | "notify_failed"
  | "expired"
  | "dead_letter";

export interface MessageRecord {
  messageId: string;
  kind: MessageKind;
  fromSession: string;
  toSession: string;
  requestId: string | null;
  replyTo: string | null;
  body: string;
  dedupKey: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface InsertMessageInput {
  messageId: string;
  kind: MessageKind;
  fromSession: string;
  toSession: string;
  body: string;
  createdAt: string;
  requestId?: string | null;
  replyTo?: string | null;
  dedupKey?: string | null;
  expiresAt?: string | null;
}

export interface DeliveryRecord {
  deliveryId: string;
  messageId: string;
  sessionId: string;
  status: DeliveryStatus;
  deliveryToken: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  notifiedAt: string | null;
  deliveredAt: string | null;
  ackedAt: string | null;
  repliedAt: string | null;
  lastError: string | null;
}

export interface InsertDeliveryInput {
  deliveryId: string;
  messageId: string;
  sessionId: string;
  status?: DeliveryStatus;
  deliveryToken?: string | null;
  leaseExpiresAt?: string | null;
  attempts?: number;
  notifiedAt?: string | null;
  deliveredAt?: string | null;
  ackedAt?: string | null;
  repliedAt?: string | null;
  lastError?: string | null;
}

export type ClaimedDelivery = DeliveryRecord & { deliveryToken: string };

export interface MessagePageInput {
  sessionId: string;
  counterpartId?: string;
  before?: { createdAt: string; messageId: string };
  limit: number;
}

export interface ThreadRecord {
  aSession: string;
  bSession: string;
  aDisplayName: string;
  aClient: string;
  aProject: string;
  bDisplayName: string;
  bClient: string;
  bProject: string;
  lastMessageId: string;
  lastKind: MessageKind;
  lastBody: string;
  lastCreatedAt: string;
  pendingRequests: number;
  pendingDeliveries: number;
}

type Row = Record<string, unknown>;

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function messageFromRow(row: Row): MessageRecord {
  return {
    messageId: String(row["message_id"]),
    kind: String(row["kind"]) as MessageKind,
    fromSession: String(row["from_session"]),
    toSession: String(row["to_session"]),
    requestId: nullableString(row["request_id"]),
    replyTo: nullableString(row["reply_to"]),
    body: String(row["body"]),
    dedupKey: nullableString(row["dedup_key"]),
    createdAt: String(row["created_at"]),
    expiresAt: nullableString(row["expires_at"]),
  };
}

function deliveryFromRow(row: Row): DeliveryRecord {
  return {
    deliveryId: String(row["delivery_id"]),
    messageId: String(row["message_id"]),
    sessionId: String(row["session_id"]),
    status: String(row["status"]) as DeliveryStatus,
    deliveryToken: nullableString(row["delivery_token"]),
    leaseExpiresAt: nullableString(row["lease_expires_at"]),
    attempts: Number(row["attempts"] ?? 0),
    notifiedAt: nullableString(row["notified_at"]),
    deliveredAt: nullableString(row["delivered_at"]),
    ackedAt: nullableString(row["acked_at"]),
    repliedAt: nullableString(row["replied_at"]),
    lastError: redactErrorDetail(nullableString(row["last_error"])),
  };
}

export class MessageRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insert(input: InsertMessageInput): MessageRecord {
    this.db
      .prepare(
        `INSERT INTO messages (
          message_id, kind, from_session, to_session, request_id, reply_to,
          body, dedup_key, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.messageId,
        input.kind,
        input.fromSession,
        input.toSession,
        input.requestId ?? null,
        input.replyTo ?? null,
        input.body,
        input.dedupKey ?? null,
        input.createdAt,
        input.expiresAt ?? null,
      );
    return this.get(input.messageId) as MessageRecord;
  }

  get(id: string): MessageRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE message_id = ?")
      .get(id) as Row | undefined;
    return row === undefined ? undefined : messageFromRow(row);
  }

  findByDedupKeyFromSender(fromSession: string, dedupKey: string): MessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE from_session = ? AND dedup_key = ?
         ORDER BY created_at, message_id`,
      )
      .all(fromSession, dedupKey) as Row[];
    return rows.map(messageFromRow);
  }

  listForSession(sessionId: string, opts: { limit?: number } = {}): MessageRecord[] {
    const limit = opts.limit ?? 100;
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE from_session = ? OR to_session = ?
         ORDER BY created_at DESC, message_id DESC
         LIMIT ?`,
      )
      .all(sessionId, sessionId, limit) as Row[];
    return rows.map(messageFromRow);
  }

  /**
   * Newest-first page for one session pair, using the stable
   * `(created_at, message_id)` cursor. Without a counterpart it covers every
   * message that involves the session.
   */
  listPage(input: MessagePageInput): MessageRecord[] {
    const params: Array<string | number> = [];
    let where: string;
    if (input.counterpartId === undefined) {
      where = "(from_session = ? OR to_session = ?)";
      params.push(input.sessionId, input.sessionId);
    } else {
      where =
        "((from_session = ? AND to_session = ?) OR (from_session = ? AND to_session = ?))";
      params.push(
        input.sessionId,
        input.counterpartId,
        input.counterpartId,
        input.sessionId,
      );
    }
    if (input.before !== undefined) {
      where +=
        " AND (created_at < ? OR (created_at = ? AND message_id < ?))";
      params.push(
        input.before.createdAt,
        input.before.createdAt,
        input.before.messageId,
      );
    }
    params.push(input.limit);
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE ${where}
         ORDER BY created_at DESC, message_id DESC
         LIMIT ?`,
      )
      .all(...params) as Row[];
    return rows.map(messageFromRow);
  }

  /**
   * One row per unordered session pair, with its latest message and counts.
   * `now` keeps pending_requests honest for a request whose deadline has
   * passed but no writer has expired it yet.
   */
  listThreads(now: string): ThreadRecord[] {
    const rows = this.db
      .prepare(
        `WITH pairs AS (
           SELECT
             CASE WHEN from_session < to_session THEN from_session ELSE to_session END AS a_session,
             CASE WHEN from_session < to_session THEN to_session ELSE from_session END AS b_session,
             message_id, kind, body, created_at
           FROM messages
         ),
         ranked AS (
           SELECT *, ROW_NUMBER() OVER (
             PARTITION BY a_session, b_session
             ORDER BY created_at DESC, message_id DESC
           ) AS rn
           FROM pairs
         )
         SELECT
           r.a_session, r.b_session,
           sa.display_name AS a_display_name, sa.client AS a_client, sa.project AS a_project,
           sb.display_name AS b_display_name, sb.client AS b_client, sb.project AS b_project,
           r.message_id AS last_message_id, r.kind AS last_kind,
           r.body AS last_body, r.created_at AS last_created_at,
           (
             SELECT COUNT(*) FROM requests q
             WHERE q.status = 'open'
               AND (q.deadline IS NULL OR q.deadline > ?)
               AND ((q.requester_session = r.a_session AND q.target_session = r.b_session)
                 OR (q.requester_session = r.b_session AND q.target_session = r.a_session))
           ) AS pending_requests,
           (
             SELECT COUNT(*) FROM deliveries d
             JOIN messages m ON m.message_id = d.message_id
             WHERE d.status IN ('stored', 'notified', 'notify_failed', 'delivered')
               AND ((m.from_session = r.a_session AND m.to_session = r.b_session)
                 OR (m.from_session = r.b_session AND m.to_session = r.a_session))
           ) AS pending_deliveries
         FROM ranked r
         JOIN sessions sa ON sa.session_id = r.a_session
         JOIN sessions sb ON sb.session_id = r.b_session
         WHERE r.rn = 1
         ORDER BY r.created_at DESC, r.message_id DESC`,
      )
      .all(now) as Row[];
    return rows.map((row) => ({
      aSession: String(row["a_session"]),
      bSession: String(row["b_session"]),
      aDisplayName: String(row["a_display_name"]),
      aClient: String(row["a_client"]),
      aProject: String(row["a_project"]),
      bDisplayName: String(row["b_display_name"]),
      bClient: String(row["b_client"]),
      bProject: String(row["b_project"]),
      lastMessageId: String(row["last_message_id"]),
      lastKind: String(row["last_kind"]) as MessageKind,
      lastBody: String(row["last_body"]),
      lastCreatedAt: String(row["last_created_at"]),
      pendingRequests: Number(row["pending_requests"]),
      pendingDeliveries: Number(row["pending_deliveries"]),
    }));
  }
}

export class DeliveryRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  insert(input: InsertDeliveryInput): DeliveryRecord {
    this.db
      .prepare(
        `INSERT INTO deliveries (
          delivery_id, message_id, session_id, status, delivery_token,
          lease_expires_at, attempts, notified_at, delivered_at, acked_at,
          replied_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.deliveryId,
        input.messageId,
        input.sessionId,
        input.status ?? "stored",
        input.deliveryToken ?? null,
        input.leaseExpiresAt ?? null,
        input.attempts ?? 0,
        input.notifiedAt ?? null,
        input.deliveredAt ?? null,
        input.ackedAt ?? null,
        input.repliedAt ?? null,
        input.lastError ?? null,
      );
    return this.get(input.deliveryId) as DeliveryRecord;
  }

  get(id: string): DeliveryRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM deliveries WHERE delivery_id = ?")
      .get(id) as Row | undefined;
    return row === undefined ? undefined : deliveryFromRow(row);
  }

  getForMessageSession(
    messageId: string,
    sessionId: string,
  ): DeliveryRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM deliveries WHERE message_id = ? AND session_id = ?",
      )
      .get(messageId, sessionId) as Row | undefined;
    return row === undefined ? undefined : deliveryFromRow(row);
  }

  getByMessageId(messageId: string): DeliveryRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM deliveries WHERE message_id = ?")
      .get(messageId) as Row | undefined;
    return row === undefined ? undefined : deliveryFromRow(row);
  }

  getByToken(token: string, sessionId: string): DeliveryRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM deliveries WHERE delivery_token = ? AND session_id = ?",
      )
      .get(token, sessionId) as Row | undefined;
    return row === undefined ? undefined : deliveryFromRow(row);
  }

  resetForRetry(deliveryId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'stored', last_error = NULL
         WHERE delivery_id = ? AND status IN ('stored', 'notify_failed')`,
      )
      .run(deliveryId);
    return Number(result.changes) > 0;
  }

  resetUnackedForResume(sessionId: string): number {
    const result = this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'notified', delivery_token = NULL, lease_expires_at = NULL
         WHERE session_id = ? AND status = 'delivered'`,
      )
      .run(sessionId);
    return Number(result.changes);
  }

  /**
   * Atomically lazy-expire, dead-letter exhausted leases, then claim at most
   * `limit` deliverable rows for one session. Callers get a fresh token and a
   * lease; the same row cannot be claimed again until that lease expires.
   */
  claim(input: {
    sessionId: string;
    limit: number;
    now: string;
    leaseSeconds: number;
    maxAttempts?: number;
  }): ClaimedDelivery[] {
    const maxAttempts = input.maxAttempts ?? 3;
    const leaseExpiresAt = new Date(
      Date.parse(input.now) + input.leaseSeconds * 1000,
    ).toISOString();

    return withImmediate(this.db, () => {
      this.db
        .prepare(
          `UPDATE deliveries
           SET status = 'expired'
           WHERE status IN ('stored', 'notified', 'notify_failed')
             AND message_id IN (
               SELECT message_id FROM messages
               WHERE expires_at IS NOT NULL AND expires_at <= ?
             )`,
        )
        .run(input.now);

      this.db
        .prepare(
          `UPDATE deliveries
           SET status = 'dead_letter'
           WHERE status = 'delivered'
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at < ?
             AND attempts >= ?`,
        )
        .run(input.now, maxAttempts);

      const rows = this.db
        .prepare(
          `SELECT d.delivery_id
           FROM deliveries d
           JOIN messages m ON m.message_id = d.message_id
           WHERE d.session_id = ?
             AND (
               d.status IN ('stored', 'notified', 'notify_failed')
               OR (d.status = 'delivered' AND d.lease_expires_at IS NOT NULL
                   AND d.lease_expires_at < ?)
             )
             AND d.attempts < ?
             AND (m.expires_at IS NULL OR m.expires_at > ?)
           ORDER BY m.created_at, d.delivery_id
           LIMIT ?`,
        )
        .all(
          input.sessionId,
          input.now,
          maxAttempts,
          input.now,
          input.limit,
        ) as Row[];

      const claimed: ClaimedDelivery[] = [];
      for (const row of rows) {
        const deliveryId = String(row["delivery_id"]);
        const token = newId();
        this.db
          .prepare(
            `UPDATE deliveries
             SET status = 'delivered',
                 delivery_token = ?,
                 lease_expires_at = ?,
                 delivered_at = ?,
                 attempts = attempts + 1
             WHERE delivery_id = ?`,
          )
          .run(token, leaseExpiresAt, input.now, deliveryId);
        const delivery = this.get(deliveryId) as DeliveryRecord;
        claimed.push({ ...delivery, deliveryToken: token });
      }
      return claimed;
    });
  }

  /**
   * Read-only view of what `claim` would consider deliverable. Used by
   * `inbox --peek`, so it must not mutate status, tokens or leases.
   */
  listPending(input: {
    sessionId: string;
    limit: number;
    now: string;
    maxAttempts?: number;
  }): DeliveryRecord[] {
    const maxAttempts = input.maxAttempts ?? 3;
    const rows = this.db
      .prepare(
        `SELECT d.*
         FROM deliveries d
         JOIN messages m ON m.message_id = d.message_id
         WHERE d.session_id = ?
           AND (
             d.status IN ('stored', 'notified', 'notify_failed')
             OR (d.status = 'delivered' AND d.lease_expires_at IS NOT NULL
                 AND d.lease_expires_at < ?)
           )
           AND d.attempts < ?
           AND (m.expires_at IS NULL OR m.expires_at > ?)
         ORDER BY m.created_at, d.delivery_id
         LIMIT ?`,
      )
      .all(
        input.sessionId,
        input.now,
        maxAttempts,
        input.now,
        input.limit,
      ) as Row[];
    return rows.map(deliveryFromRow);
  }

  ack(token: string, sessionId: string, now: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'acked', acked_at = ?
         WHERE delivery_token = ? AND session_id = ?
           AND status IN ('delivered', 'acked')`,
      )
      .run(now, token, sessionId);
    return Number(result.changes) > 0;
  }

  markReplied(messageId: string, sessionId: string, now: string): void {
    this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'acked', acked_at = COALESCE(acked_at, ?), replied_at = ?
         WHERE message_id = ? AND session_id = ?
           AND status NOT IN ('expired', 'dead_letter')`,
      )
      .run(now, now, messageId, sessionId);
  }

  markNotified(id: string, now: string): void {
    this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'notified', notified_at = ?, last_error = NULL
         WHERE delivery_id = ?
           AND status NOT IN ('delivered', 'acked', 'expired', 'dead_letter')`,
      )
      .run(now, id);
  }

  markNotifyFailed(id: string, now: string, error: string): void {
    this.db
      .prepare(
        `UPDATE deliveries
         SET status = 'notify_failed', last_error = ?
         WHERE delivery_id = ?
           AND status NOT IN ('delivered', 'acked', 'expired', 'dead_letter')`,
      )
      .run(redactErrorDetail(error) ?? "", id);
  }
}
