import type { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;

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

/**
 * Create or upgrade the store schema. Version 1 is the Phase 1 baseline;
 * later phases add tables through explicit migrations.
 */
export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | Record<string, unknown>
    | undefined;
  const version = Number(row?.["user_version"] ?? 0);

  if (version === SCHEMA_VERSION) {
    return;
  }
  if (version !== 0) {
    throw new Error(`unsupported database schema version ${version}`);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(SCHEMA_SQL);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
