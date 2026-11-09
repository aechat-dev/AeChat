import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";
import { EventRepository } from "../../../src/core/store/events.js";
import { migrate } from "../../../src/core/store/schema.js";

const databases: Array<{ close(): void }> = [];

function memoryDatabase() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  return db;
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("event cursor", () => {
  it("keeps seq stable and monotonic across VACUUM", () => {
    const db = memoryDatabase();
    const events = new EventRepository(db);
    const first = events.record({
      event: "send",
      ts: "2026-11-07T00:00:00.000Z",
    });
    const second = events.record({
      event: "notify",
      ts: "2026-11-07T00:00:01.000Z",
    });
    const third = events.record({
      event: "ack",
      ts: "2026-11-07T00:00:02.000Z",
    });

    const before = events.listAfter(0);
    expect(before.map((record) => record.seq)).toEqual([1, 2, 3]);

    db.exec("VACUUM");

    const after = events.listAfter(0);
    expect(after.map((record) => record.seq)).toEqual([1, 2, 3]);
    expect(after.map((record) => record.eventId)).toEqual(
      before.map((record) => record.eventId),
    );
    expect([first, second, third]).toHaveLength(3);
    expect(events.listAfter(before[0]?.seq as number)).toHaveLength(2);
  });

  it("never reuses a seq after deletion", () => {
    const db = memoryDatabase();
    const events = new EventRepository(db);
    events.record({ event: "send" });
    const deleted = events.record({ event: "notify" });
    db.prepare("DELETE FROM events WHERE event_id = ?").run(deleted);
    events.record({ event: "ack" });

    expect(events.listAfter(0).map((record) => record.seq)).toEqual([1, 3]);
  });

  it("upgrades a v4 events table without losing rows", () => {
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
      CREATE TABLE events (
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
      CREATE TABLE deliveries (
        delivery_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
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
      PRAGMA user_version = 4;
    `);
    const insert = db.prepare(
      `INSERT INTO events (event_id, ts, level, event) VALUES (?, ?, 'info', ?)`,
    );
    insert.run("event-1", "2026-11-07T00:00:00.000Z", "send");
    insert.run("event-2", "2026-11-07T00:00:01.000Z", "notify");

    migrate(db);

    const records = new EventRepository(db).listAfter(0);
    expect(
      records.map((record) => [record.seq, record.eventId, record.event]),
    ).toEqual([
      [1, "event-1", "send"],
      [2, "event-2", "notify"],
    ]);
  });

  it("rejects invalid cursors and limits", () => {
    const events = new EventRepository(memoryDatabase());
    expect(() => events.listAfter(-1)).toThrow();
    expect(() => events.listAfter(1.5)).toThrow();
    expect(() => events.listAfter(0, 0)).toThrow();
  });
});
