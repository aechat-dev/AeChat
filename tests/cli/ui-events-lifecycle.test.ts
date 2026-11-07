import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import { migrate } from "../../src/core/store/schema.js";

const dirs: string[] = [];
const children: Array<ReturnType<typeof spawn>> = [];

afterEach(() => {
  while (children.length > 0) {
    const child = children.pop();
    if (child !== undefined && child.exitCode === null && !child.killed) {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function seedEvents(count: number): { home: string; dbPath: string } {
  const home = mkdtempSync(join(tmpdir(), "aechat-ui-events-"));
  dirs.push(home);
  const dbPath = join(home, "aechat.db");
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    const insert = db.prepare(
      `INSERT INTO events (event_id, ts, level, event, message_id)
       VALUES (?, ?, 'info', 'notify', ?)`,
    );
    db.exec("BEGIN");
    for (let index = 0; index < count; index += 1) {
      insert.run(
        `event-${index}`,
        new Date(Date.parse("2026-11-07T00:00:00.000Z") + index).toISOString(),
        `message-${index}`,
      );
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  return { home, dbPath };
}

describe("ui-events lifecycle", () => {
  it(
    "exits on SIGTERM while stdout backpressure is blocking",
    async () => {
      const { home, dbPath } = seedEvents(20_000);
      const child = spawn(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli/main.ts", "ui-events", "--after", "0"],
        {
          cwd: process.cwd(),
          env: { ...process.env, AECHAT_HOME: home, AECHAT_DB: dbPath },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        },
      );
      children.push(child);
      // Deliberately do not read stdout: the pipe fills and writeLine blocks.

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(child.exitCode).toBeNull();

      const exited = once(child, "exit");
      // tsx runs the CLI in a child process; signal the whole group.
      process.kill(-(child.pid as number), "SIGTERM");
      const result = await Promise.race([
        exited,
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 1500),
        ),
      ]);

      child.stdout?.destroy();
      child.stderr?.destroy();

      expect(result).not.toBe("timeout");
      expect(child.exitCode).toBe(0);
    },
    15_000,
  );
});
