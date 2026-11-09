import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 7;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  client TEXT NOT NULL CHECK (client IN ('claude-code', 'codex', 'other')),
  project TEXT NOT NULL,
  conversation_id TEXT,
  bound_scope TEXT NOT NULL DEFAULT 'none'
    CHECK (bound_scope IN ('conversation', 'host_role', 'none')),
  bound_at TEXT,
  bound_checked_at TEXT,
  capabilities_json TEXT,
  last_seen_at TEXT NOT NULL,
  host_seen_at TEXT,
  resume_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (resume_state IN ('idle', 'resume_pending')),
  resume_count INTEGER NOT NULL DEFAULT 0,
  resumed_at TEXT,
  created_at TEXT NOT NULL,
  left_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_display_name ON sessions(display_name);
CREATE INDEX IF NOT EXISTS sessions_conversation_id ON sessions(conversation_id);
CREATE INDEX IF NOT EXISTS sessions_left_at ON sessions(left_at);

CREATE TABLE IF NOT EXISTS transport_bindings (
  binding_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  transport TEXT NOT NULL,
  address TEXT NOT NULL,
  team TEXT,
  mode TEXT,
  state TEXT NOT NULL
    CHECK (state IN ('pending', 'bound', 'stale', 'released', 'failed')),
  bound_at TEXT,
  last_verified_at TEXT,
  evidence_json TEXT,
  UNIQUE(transport, address)
);
CREATE INDEX IF NOT EXISTS transport_bindings_session ON transport_bindings(session_id);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  delivery_id TEXT,
  request_id TEXT,
  transport TEXT,
  mode TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_detail TEXT,
  data_json TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS events_message ON events(message_id, ts);

CREATE TABLE IF NOT EXISTS probes (
  probe_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  client TEXT NOT NULL,
  client_version TEXT,
  observed_level TEXT NOT NULL,
  busy_receive INTEGER,
  idle_wakeup INTEGER,
  evidence_json TEXT,
  observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS probes_session ON probes(session_id, observed_at);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('notify', 'request', 'reply')),
  from_session TEXT NOT NULL REFERENCES sessions(session_id),
  to_session TEXT NOT NULL REFERENCES sessions(session_id),
  request_id TEXT,
  reply_to TEXT,
  body TEXT NOT NULL,
  dedup_key TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS messages_to_session ON messages(to_session, created_at);
CREATE INDEX IF NOT EXISTS messages_from_session ON messages(from_session, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS messages_dedup
  ON messages(from_session, to_session, dedup_key)
  WHERE dedup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(message_id),
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  status TEXT NOT NULL
    CHECK (status IN (
      'stored', 'notified', 'delivered', 'acked', 'notify_failed',
      'expired', 'dead_letter'
    )),
  delivery_token TEXT UNIQUE,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  delivered_at TEXT,
  acked_at TEXT,
  replied_at TEXT,
  last_error TEXT,
  UNIQUE(message_id, session_id)
);
CREATE INDEX IF NOT EXISTS deliveries_session_status
  ON deliveries(session_id, status, lease_expires_at);
CREATE INDEX IF NOT EXISTS deliveries_status_lease
  ON deliveries(status, lease_expires_at);
`;

const SCHEMA_V3_SQL = `
CREATE TABLE IF NOT EXISTS requests (
  request_id TEXT PRIMARY KEY REFERENCES messages(message_id),
  requester_session TEXT NOT NULL REFERENCES sessions(session_id),
  target_session TEXT NOT NULL REFERENCES sessions(session_id),
  status TEXT NOT NULL CHECK (status IN ('open', 'replied', 'expired', 'cancelled')),
  close_reason TEXT
    CHECK (close_reason IS NULL OR close_reason IN (
      'replied', 'deadline', 'sender_cancel', 'target_left', 'requester_left'
    )),
  deadline TEXT,
  reply_message_id TEXT REFERENCES messages(message_id),
  created_at TEXT NOT NULL,
  status_changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_target_status
  ON requests(target_session, status, created_at);
CREATE INDEX IF NOT EXISTS requests_requester_status
  ON requests(requester_session, status, created_at);
`;

const SCHEMA_V4_SQL = `
ALTER TABLE sessions ADD COLUMN host_seen_source TEXT;
`;

/**
 * The implicit rowid is not a durable cursor: SQLite may renumber it when a
 * table is rebuilt or vacuumed. Give events an explicit autoincrement key so
 * `ui-events --after <seq>` survives maintenance.
 */
const SCHEMA_V5_SQL = `
CREATE TABLE events_v5 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  delivery_id TEXT,
  request_id TEXT,
  transport TEXT,
  mode TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_detail TEXT,
  data_json TEXT
);
INSERT INTO events_v5 (
  event_id, ts, level, event, session_id, message_id, delivery_id,
  request_id, transport, mode, exit_code, duration_ms, error_code,
  error_detail, data_json
)
SELECT
  event_id, ts, level, event, session_id, message_id, delivery_id,
  request_id, transport, mode, exit_code, duration_ms, error_code,
  error_detail, data_json
FROM events
ORDER BY rowid;
DROP TABLE events;
ALTER TABLE events_v5 RENAME TO events;
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS events_message ON events(message_id, ts);
`;

/**
 * Host ids are declared by adapters, so the store must not reject an id that
 * does not exist yet. SQLite cannot drop a CHECK constraint in place; rebuild
 * the table and let `foreign_key_check` validate the result.
 */
const SCHEMA_V6_SQL = `
CREATE TABLE sessions_v6 (
  session_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  client TEXT NOT NULL,
  project TEXT NOT NULL,
  conversation_id TEXT,
  bound_scope TEXT NOT NULL DEFAULT 'none'
    CHECK (bound_scope IN ('conversation', 'host_role', 'none')),
  bound_at TEXT,
  bound_checked_at TEXT,
  capabilities_json TEXT,
  last_seen_at TEXT NOT NULL,
  host_seen_at TEXT,
  resume_state TEXT NOT NULL DEFAULT 'idle'
    CHECK (resume_state IN ('idle', 'resume_pending')),
  resume_count INTEGER NOT NULL DEFAULT 0,
  resumed_at TEXT,
  created_at TEXT NOT NULL,
  left_at TEXT,
  host_seen_source TEXT
);
INSERT INTO sessions_v6 (
  session_id, display_name, client, project, conversation_id, bound_scope,
  bound_at, bound_checked_at, capabilities_json, last_seen_at, host_seen_at,
  resume_state, resume_count, resumed_at, created_at, left_at, host_seen_source
)
SELECT
  session_id, display_name, client, project, conversation_id, bound_scope,
  bound_at, bound_checked_at, capabilities_json, last_seen_at, host_seen_at,
  resume_state, resume_count, resumed_at, created_at, left_at, host_seen_source
FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_v6 RENAME TO sessions;
CREATE INDEX IF NOT EXISTS sessions_display_name ON sessions(display_name);
CREATE INDEX IF NOT EXISTS sessions_conversation_id ON sessions(conversation_id);
CREATE INDEX IF NOT EXISTS sessions_left_at ON sessions(left_at);
`;

const SCHEMA_V7_SQL = `
ALTER TABLE deliveries ADD COLUMN direct_attempted INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATIONS: Record<number, string> = {
  1: SCHEMA_SQL,
  2: SCHEMA_V2_SQL,
  3: SCHEMA_V3_SQL,
  4: SCHEMA_V4_SQL,
  5: SCHEMA_V5_SQL,
  6: SCHEMA_V6_SQL,
  7: SCHEMA_V7_SQL,
};

/**
 * Read-only readers cannot migrate. Fail with an actionable message instead
 * of surfacing a missing-column SQLite error on the first query.
 */
export function assertCurrentSchema(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | Record<string, unknown>
    | undefined;
  const version = Number(row?.["user_version"] ?? 0);
  if (version !== SCHEMA_VERSION) {
    throw new Error(
      `database schema version ${version} is not supported (expected ${SCHEMA_VERSION}); run aechat once to migrate it`,
    );
  }
}

/**
 * Create or upgrade the store schema. Migrations are applied in order, each
 * in its own IMMEDIATE transaction; a database newer than this binary is
 * rejected rather than opened with unknown columns.
 */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | Record<string, unknown>
    | undefined;
  let version = Number(row?.["user_version"] ?? 0);

  if (version > SCHEMA_VERSION) {
    throw new Error(`unsupported database schema version ${version}`);
  }

  const foreignKeys = db.prepare("PRAGMA foreign_keys").get() as
    | Record<string, unknown>
    | undefined;
  const restoreForeignKeys = Number(foreignKeys?.["foreign_keys"] ?? 0) === 1;
  if (restoreForeignKeys) {
    // A table rebuild must drop a parent table. Validate every row after each
    // migration and restore the connection setting even if one fails.
    db.exec("PRAGMA foreign_keys = OFF");
  }
  try {
    while (version < SCHEMA_VERSION) {
      const next = version + 1;
      const sql = MIGRATIONS[next];
      if (sql === undefined) {
        throw new Error(`missing migration ${next}`);
      }
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(sql);
        const broken = db.prepare("PRAGMA foreign_key_check").all();
        if (broken.length > 0) {
          throw new Error(`migration ${next} broke foreign keys`);
        }
        db.exec(`PRAGMA user_version = ${next}`);
        db.exec("COMMIT");
        version = next;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } finally {
    if (restoreForeignKeys) {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
}
