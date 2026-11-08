import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, openReadOnlyDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import { migrate } from "../../src/core/store/schema.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";
import { createReadOnlyRuntime } from "../../src/runtime/read-only-runtime.js";
import { createRuntime } from "../../src/runtime/runtime.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function seededDatabase(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "aechat-readonly-"));
  dirs.push(dir);
  const path = join(dir, "aechat.db");
  const db = openDatabase(path);
  try {
    migrate(db);
    new EventRepository(db).record({
      event: "send",
      ts: "2026-11-07T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
  return { dir, path };
}

describe("openReadOnlyDatabase", () => {
  it("rejects writes and keeps the existing events", () => {
    const { path } = seededDatabase();
    const db = openReadOnlyDatabase(path);
    try {
      expect(() =>
        new EventRepository(db).record({ event: "inbox_claim" }),
      ).toThrow();
    } finally {
      db.close();
    }

    const check = openDatabase(path);
    try {
      expect(new EventRepository(check).listAfter(0)).toHaveLength(1);
    } finally {
      check.close();
    }
  });

  it("does not change the database file mode", () => {
    const { path } = seededDatabase();
    chmodSync(path, 0o640);

    const db = openReadOnlyDatabase(path);
    try {
      expect(statSync(path).mode & 0o777).toBe(0o640);
    } finally {
      db.close();
    }
  });
});

describe("createReadOnlyRuntime", () => {
  it("rejects an outdated schema with an actionable message", () => {
    const { dir, path } = seededDatabase();
    const db = openDatabase(path);
    try {
      db.exec("PRAGMA user_version = 4");
    } finally {
      db.close();
    }

    expect(() =>
      createReadOnlyRuntime({
        home: dir,
        dbPath: path,
        transport: new FakeTransportAdapter(),
      }),
    ).toThrow(/schema version 4 is not supported.*run aechat/);
  });

  it("exposes queries without write services and preserves state", async () => {
    const { dir, path } = seededDatabase();
    const writable = createRuntime({
      home: dir,
      dbPath: path,
      transport: new FakeTransportAdapter(),
      now: () => "2026-11-07T00:00:00.000Z",
    });
    let sessionId: string;
    try {
      const registered = await writable.service.register({
        displayName: "readonly",
        client: "claude-code",
        project: "/tmp/readonly",
      });
      sessionId = registered.session.sessionId;
    } finally {
      writable.close();
    }

    const beforeRead = openDatabase(path);
    let before: number;
    try {
      before = (
        beforeRead.prepare("SELECT COUNT(*) AS count FROM events").get() as {
          count: number;
        }
      ).count;
    } finally {
      beforeRead.close();
    }

    const runtime = createReadOnlyRuntime({
      home: dir,
      dbPath: path,
      transport: new FakeTransportAdapter(),
      now: () => "2026-11-07T00:00:00.000Z",
    });
    try {
      expect("service" in runtime).toBe(false);
      expect("delivery" in runtime).toBe(false);
      expect("audit" in runtime).toBe(false);
      expect("probe" in runtime.capabilities).toBe(false);

      const sessions = await runtime.sessionQuery.list();
      expect(sessions.map((session) => session.session_id)).toContain(
        sessionId,
      );
      expect(() => runtime.events.record({ event: "list" })).toThrow();
    } finally {
      runtime.close();
    }

    const check = openDatabase(path);
    try {
      const eventCount = check
        .prepare("SELECT COUNT(*) AS count FROM events")
        .get() as { count: number };
      expect(eventCount.count).toBe(before);
    } finally {
      check.close();
    }
  });
});
