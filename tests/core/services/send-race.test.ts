import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const workerPath = join(repoRoot, "tests/fixtures/send-race-worker.mts");
const tempDirs: string[] = [];

function prepareDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), "aechat-send-race-"));
  tempDirs.push(dir);
  const dbPath = join(dir, "aechat.db");
  const db = openDatabase(dbPath);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  for (const [sessionId, name] of [
    ["from-session", "from"],
    ["to-a", "to-a"],
    ["to-b", "to-b"],
  ] as const) {
    sessions.create({
      sessionId,
      displayName: name,
      client: "claude-code",
      project: `/tmp/${name}`,
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    bindings.create({
      bindingId: `binding-${sessionId}`,
      sessionId,
      transport: "fake",
      address: `aechat-${sessionId}`,
      state: "bound",
    });
  }
  db.close();
  return dir;
}

interface WorkerResult {
  ok: boolean;
  messageId?: string;
  code?: string;
}

function runWorker(
  dir: string,
  toSession: string,
  startFile: string,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        workerPath,
        join(dir, "aechat.db"),
        "from-session",
        toSession,
        "race-key",
        startFile,
        "150",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, AECHAT_REPO_ROOT: repoRoot },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`send-race worker timed out: ${stderr}`));
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`send-race worker exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()) as WorkerResult);
      } catch {
        reject(new Error(`bad worker output: ${stdout} / ${stderr}`));
      }
    });
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("send dedup across processes", () => {
  it(
    "both processes return the same message for the same target",
    async () => {
      const dir = prepareDatabase();
      const startFile = join(dir, "start");
      const first = runWorker(dir, "to-a", startFile);
      const second = runWorker(dir, "to-a", startFile);
      writeFileSync(startFile, "go");

      const results = await Promise.all([first, second]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(results[0]?.messageId).toBeTypeOf("string");
      expect(results[1]?.messageId).toBe(results[0]?.messageId);

      const db = openDatabase(join(dir, "aechat.db"));
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM messages")
        .get() as { n: number };
      db.close();
      expect(count.n).toBe(1);
    },
    15_000,
  );

  it(
    "a different target with the same key loses with invalid_input",
    async () => {
      const dir = prepareDatabase();
      const startFile = join(dir, "start");
      const first = runWorker(dir, "to-a", startFile);
      const second = runWorker(dir, "to-b", startFile);
      writeFileSync(startFile, "go");

      const results = await Promise.all([first, second]);
      const failed = results.filter((result) => !result.ok);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.code).toBe("invalid_input");
      expect(results.filter((result) => result.ok)).toHaveLength(1);

      const db = openDatabase(join(dir, "aechat.db"));
      const count = db
        .prepare("SELECT COUNT(*) AS n FROM messages")
        .get() as { n: number };
      db.close();
      expect(count.n).toBe(1);
    },
    15_000,
  );
});
