import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../../src/cli/commands/context.js";
import {
  heartbeatCommand,
  heartbeatPidPath,
} from "../../src/cli/commands/heartbeat.js";
import { SessionService } from "../../src/core/services/session-service.js";
import { openDatabase } from "../../src/core/store/db.js";
import { migrate } from "../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const tempDirs: string[] = [];
const databases: Array<{ close(): void }> = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

function setup() {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const service = new SessionService({
    sessions,
    bindings,
    transport: new FakeTransportAdapter(),
    now: () => "2026-11-07T00:00:00.000Z",
  });
  const ctx = {
    service,
    now: () => "2026-11-07T00:00:00.000Z",
  } as unknown as CommandContext;

  sessions.create({
    sessionId: "heartbeat-session",
    displayName: "heartbeat",
    client: "claude-code",
    project: "/tmp/heartbeat",
    lastSeenAt: "2026-11-06T00:00:00.000Z",
    createdAt: "2026-11-06T00:00:00.000Z",
  });
  return { db, sessions, service, ctx };
}

async function waitFor(path: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      statSync(path);
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for ${path}`);
      }
      await delay(25);
    }
  }
}

describe("heartbeat command", () => {
  it("updates last_seen, host_seen and the heartbeat source", async () => {
    const { service, ctx } = setup();

    const data = await heartbeatCommand(
      ["--session", "heartbeat-session"],
      ctx,
    );
    const session = service.whoami({ sessionId: "heartbeat-session" });

    expect(data["session_id"]).toBe("heartbeat-session");
    expect(session.lastSeenAt).toBe("2026-11-07T00:00:00.000Z");
    expect(session.hostSeenAt).not.toBeNull();
    expect(session.hostSeenSource).toBe("heartbeat");
  });

  it("interval loop writes a pidfile and removes it on SIGTERM", async () => {
    const home = mkdtempSync(join(tmpdir(), "aechat-heartbeat-"));
    tempDirs.push(home);
    const db = openDatabase(join(home, "aechat.db"));
    migrate(db);
    const sessions = new SessionRepository(db);
    sessions.create({
      sessionId: "heartbeat-loop",
      displayName: "heartbeat-loop",
      client: "claude-code",
      project: "/tmp/heartbeat-loop",
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    db.close();

    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        join(repoRoot, "src/cli/main.ts"),
        "heartbeat",
        "--session",
        "heartbeat-loop",
        "--interval",
        "0.05",
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, AECHAT_HOME: home },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const pidFile = heartbeatPidPath("heartbeat-loop", home);
    await waitFor(pidFile);
    await delay(150);
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((resolve) => {
      child.once("close", resolve);
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(() => statSync(pidFile)).toThrow();
  });
});
