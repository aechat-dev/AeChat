import { DatabaseSync } from "node:sqlite";

/**
 * Open the SQLite store and apply connection-level safety settings.
 * Schema creation is a separate `migrate` step so callers control when a
 * migration runs.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  return db;
}
