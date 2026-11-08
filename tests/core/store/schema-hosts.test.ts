import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";
import { migrate } from "../../../src/core/store/schema.js";
import { SessionRepository } from "../../../src/core/store/sessions.js";

const databases: Array<{ close(): void }> = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("sessions host schema", () => {
  it("accepts a host id that the core type does not declare", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    migrate(db);
    const sessions = new SessionRepository(db);

    const created = sessions.create({
      sessionId: "third",
      displayName: "third",
      client: "third-host",
      project: "/tmp/third",
      lastSeenAt: "2026-11-08T00:00:00.000Z",
      createdAt: "2026-11-08T00:00:00.000Z",
    });

    expect(created.client).toBe("third-host");
    expect(sessions.get("third")?.client).toBe("third-host");
  });

  it("rebuilds the v5 client CHECK without losing sessions", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    db.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        client TEXT NOT NULL CHECK (client IN ('claude-code', 'codex', 'other')),
        project TEXT NOT NULL,
        conversation_id TEXT,
        bound_scope TEXT NOT NULL DEFAULT 'none',
        bound_at TEXT,
        bound_checked_at TEXT,
        capabilities_json TEXT,
        last_seen_at TEXT NOT NULL,
        host_seen_at TEXT,
        resume_state TEXT NOT NULL DEFAULT 'idle',
        resume_count INTEGER NOT NULL DEFAULT 0,
        resumed_at TEXT,
        created_at TEXT NOT NULL,
        left_at TEXT,
        host_seen_source TEXT
      );
      CREATE TABLE transport_bindings (
        binding_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(session_id),
        transport TEXT NOT NULL,
        address TEXT NOT NULL,
        team TEXT,
        mode TEXT,
        state TEXT NOT NULL,
        bound_at TEXT,
        last_verified_at TEXT,
        evidence_json TEXT,
        UNIQUE(transport, address)
      );
      INSERT INTO sessions (
        session_id, display_name, client, project, last_seen_at, created_at
      ) VALUES (
        'v5', 'v5', 'claude-code', '/tmp/v5',
        '2026-11-08T00:00:00.000Z', '2026-11-08T00:00:00.000Z'
      );
      INSERT INTO transport_bindings (
        binding_id, session_id, transport, address, state
      ) VALUES ('binding-v5', 'v5', 'fake', 'aechat-v5', 'bound');
      PRAGMA user_version = 5;
    `);

    migrate(db);

    const sessions = new SessionRepository(db);
    expect(sessions.get("v5")?.client).toBe("claude-code");
    expect(
      db.prepare("SELECT session_id FROM transport_bindings").get(),
    ).toMatchObject({ session_id: "v5" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const created = sessions.create({
      sessionId: "v6",
      displayName: "v6",
      client: "third-host",
      project: "/tmp/v6",
      lastSeenAt: "2026-11-08T00:00:00.000Z",
      createdAt: "2026-11-08T00:00:00.000Z",
    });
    expect(created.client).toBe("third-host");
  });
});
