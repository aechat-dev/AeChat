import type { DatabaseSync } from "node:sqlite";

import type {
  BindingId,
  BoundScope,
  Client,
  ResumeState,
  SessionId,
  SessionRecord,
  TransportBindingRecord,
  TransportState,
} from "../types.js";

type Row = Record<string, unknown>;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`database row is missing string field ${field}`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function sessionFromRow(row: Row): SessionRecord {
  return {
    sessionId: requiredString(row["session_id"], "session_id"),
    displayName: requiredString(row["display_name"], "display_name"),
    client: requiredString(row["client"], "client") as Client,
    project: requiredString(row["project"], "project"),
    conversationId: nullableString(row["conversation_id"]),
    boundScope: requiredString(row["bound_scope"], "bound_scope") as BoundScope,
    boundAt: nullableString(row["bound_at"]),
    boundCheckedAt: nullableString(row["bound_checked_at"]),
    capabilitiesJson: nullableString(row["capabilities_json"]),
    lastSeenAt: requiredString(row["last_seen_at"], "last_seen_at"),
    hostSeenAt: nullableString(row["host_seen_at"]),
    resumeState: requiredString(row["resume_state"], "resume_state") as ResumeState,
    resumeCount: Number(row["resume_count"] ?? 0),
    resumedAt: nullableString(row["resumed_at"]),
    createdAt: requiredString(row["created_at"], "created_at"),
    leftAt: nullableString(row["left_at"]),
  };
}

function bindingFromRow(row: Row): TransportBindingRecord {
  return {
    bindingId: requiredString(row["binding_id"], "binding_id"),
    sessionId: requiredString(row["session_id"], "session_id"),
    transport: requiredString(row["transport"], "transport"),
    address: requiredString(row["address"], "address"),
    team: nullableString(row["team"]),
    mode: nullableString(row["mode"]),
    state: requiredString(row["state"], "state") as TransportState,
    boundAt: nullableString(row["bound_at"]),
    lastVerifiedAt: nullableString(row["last_verified_at"]),
    evidenceJson: nullableString(row["evidence_json"]),
  };
}

export interface CreateSessionInput {
  sessionId: SessionId;
  displayName: string;
  client: Client;
  project: string;
  lastSeenAt: string;
  createdAt: string;
  conversationId?: string | null;
  boundScope?: BoundScope;
  boundAt?: string | null;
  boundCheckedAt?: string | null;
  capabilitiesJson?: string | null;
  hostSeenAt?: string | null;
  resumeState?: ResumeState;
  resumeCount?: number;
  resumedAt?: string | null;
  leftAt?: string | null;
}

export interface UpdateBindingInput {
  sessionId: SessionId;
  boundScope: BoundScope;
  boundAt?: string | null;
  boundCheckedAt?: string | null;
  conversationId?: string | null;
}

export interface CreateBindingInput {
  bindingId: BindingId;
  sessionId: SessionId;
  transport: string;
  address: string;
  state: TransportState;
  team?: string | null;
  mode?: string | null;
  boundAt?: string | null;
  lastVerifiedAt?: string | null;
  evidenceJson?: string | null;
}

export class SessionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: CreateSessionInput): SessionRecord {
    this.db
      .prepare(
        `INSERT INTO sessions (
          session_id, display_name, client, project, conversation_id,
          bound_scope, bound_at, bound_checked_at, capabilities_json,
          last_seen_at, host_seen_at, resume_state, resume_count, resumed_at,
          created_at, left_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.displayName,
        input.client,
        input.project,
        input.conversationId ?? null,
        input.boundScope ?? "none",
        input.boundAt ?? null,
        input.boundCheckedAt ?? null,
        input.capabilitiesJson ?? null,
        input.lastSeenAt,
        input.hostSeenAt ?? null,
        input.resumeState ?? "idle",
        input.resumeCount ?? 0,
        input.resumedAt ?? null,
        input.createdAt,
        input.leftAt ?? null,
      );
    return this.get(input.sessionId) as SessionRecord;
  }

  get(id: SessionId): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(id) as Row | undefined;
    return row === undefined ? undefined : sessionFromRow(row);
  }

  findByDisplayName(name: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE display_name = ? ORDER BY created_at, session_id",
      )
      .all(name) as Row[];
    return rows.map(sessionFromRow);
  }

  findByConversationId(id: string): SessionRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE conversation_id = ? ORDER BY created_at, session_id",
      )
      .all(id) as Row[];
    return rows.map(sessionFromRow);
  }

  list(opts: { includeLeft?: boolean } = {}): SessionRecord[] {
    const sql = opts.includeLeft
      ? "SELECT * FROM sessions ORDER BY created_at, session_id"
      : "SELECT * FROM sessions WHERE left_at IS NULL ORDER BY created_at, session_id";
    const rows = this.db.prepare(sql).all() as Row[];
    return rows.map(sessionFromRow);
  }

  touch(id: SessionId, at: string, opts: { host?: boolean } = {}): void {
    if (opts.host === true) {
      this.db
        .prepare(
          "UPDATE sessions SET last_seen_at = ?, host_seen_at = ? WHERE session_id = ?",
        )
        .run(at, at, id);
      return;
    }
    this.db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?")
      .run(at, id);
  }

  updateBinding(input: UpdateBindingInput): boolean {
    const fields = ["bound_scope = ?"];
    const values: Array<string | null> = [input.boundScope];
    if (input.boundAt !== undefined) {
      fields.push("bound_at = ?");
      values.push(input.boundAt);
    }
    if (input.boundCheckedAt !== undefined) {
      fields.push("bound_checked_at = ?");
      values.push(input.boundCheckedAt);
    }
    if (input.conversationId !== undefined) {
      fields.push("conversation_id = ?");
      values.push(input.conversationId);
    }
    values.push(input.sessionId);
    const result = this.db
      .prepare(`UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`)
      .run(...values);
    return Number(result.changes) > 0;
  }

  setResumeState(id: SessionId, state: ResumeState): boolean {
    const result = this.db
      .prepare("UPDATE sessions SET resume_state = ? WHERE session_id = ?")
      .run(state, id);
    return Number(result.changes) > 0;
  }

  markLeft(id: SessionId, at: string): void {
    this.db
      .prepare("UPDATE sessions SET left_at = ? WHERE session_id = ? AND left_at IS NULL")
      .run(at, id);
  }
}

export class TransportBindingRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  create(input: CreateBindingInput): TransportBindingRecord {
    this.db
      .prepare(
        `INSERT INTO transport_bindings (
          binding_id, session_id, transport, address, team, mode, state,
          bound_at, last_verified_at, evidence_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.bindingId,
        input.sessionId,
        input.transport,
        input.address,
        input.team ?? null,
        input.mode ?? null,
        input.state,
        input.boundAt ?? null,
        input.lastVerifiedAt ?? null,
        input.evidenceJson ?? null,
      );
    return this.getById(input.bindingId) as TransportBindingRecord;
  }

  getById(id: BindingId): TransportBindingRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM transport_bindings WHERE binding_id = ?")
      .get(id) as Row | undefined;
    return row === undefined ? undefined : bindingFromRow(row);
  }

  getByAddress(
    transport: string,
    address: string,
  ): TransportBindingRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM transport_bindings WHERE transport = ? AND address = ?",
      )
      .get(transport, address) as Row | undefined;
    return row === undefined ? undefined : bindingFromRow(row);
  }

  listForSession(sessionId: SessionId): TransportBindingRecord[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM transport_bindings WHERE session_id = ? ORDER BY binding_id",
      )
      .all(sessionId) as Row[];
    return rows.map(bindingFromRow);
  }

  updateState(
    id: BindingId,
    state: TransportState,
    at: string | null = null,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE transport_bindings
         SET state = ?,
             last_verified_at = COALESCE(?, last_verified_at),
             bound_at = CASE WHEN ? = 'bound' THEN COALESCE(bound_at, ?) ELSE bound_at END
         WHERE binding_id = ?`,
      )
      .run(state, at, state, at, id);
    return Number(result.changes) > 0;
  }
}
