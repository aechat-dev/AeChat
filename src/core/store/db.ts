import { chmodSync } from "node:fs";

import { DatabaseSync } from "node:sqlite";

/**
 * Open the SQLite store and apply connection-level safety settings.
 * Schema creation is a separate `migrate` step so callers control when a
 * migration runs.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") {
    // Message bodies live here; do not rely on the process umask.
    chmodSync(path, 0o600);
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}

/**
 * Run a multi-statement write under BEGIN IMMEDIATE. SQLite serializes the
 * writer slot, so claim operations cannot hand the same delivery to two
 * callers.
 */
export function withImmediate<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}
