import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createRuntime } from "../../src/app/runtime.js";
import { main } from "../../src/cli/main.js";
import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";

const dirs: string[] = [];
const envKeys = ["AECHAT_HOME", "AECHAT_DB"] as const;
const previousEnv = new Map<string, string | undefined>();

function preserveEnv(): void {
  for (const key of envKeys) {
    previousEnv.set(key, process.env[key]);
  }
}

function restoreEnv(): void {
  for (const key of envKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function capture(stream: NodeJS.WriteStream): string[] {
  const chunks: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  });
  return chunks;
}

interface Fixture {
  home: string;
  a: string;
  b: string;
  messageId: string;
  events: number;
}

async function fixture(): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), "aechat-ui-bridge-"));
  dirs.push(home);
  const dbPath = join(home, "aechat.db");
  const runtime = createRuntime({
    home,
    dbPath,
    transport: new FakeTransportAdapter(),
    now: () => "2026-11-07T00:00:00.000Z",
  });
  let a: string;
  let b: string;
  let messageId: string;
  try {
    a = (
      await runtime.service.register({
        displayName: "bridge-a",
        client: "claude-code",
        project: "/tmp/bridge-a",
      })
    ).session.sessionId;
    b = (
      await runtime.service.register({
        displayName: "bridge-b",
        client: "codex",
        project: "/tmp/bridge-b",
      })
    ).session.sessionId;
    messageId = (
      await runtime.delivery.send({
        fromSession: a,
        toSession: b,
        kind: "notify",
        body: "bridge message",
      })
    ).messageId;
  } finally {
    runtime.close();
  }

  const check = openDatabase(dbPath);
  let events: number;
  try {
    events = new EventRepository(check).listAfter(0).length;
  } finally {
    check.close();
  }
  return { home, a, b, messageId, events };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  restoreEnv();
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("ui bridge commands", () => {
  it("ui-snapshot returns the session and thread contract without new events", async () => {
    preserveEnv();
    const { home, a, b, events } = await fixture();
    process.env["AECHAT_HOME"] = home;
    process.env["AECHAT_DB"] = join(home, "aechat.db");
    const stdout = capture(process.stdout);

    const code = await main(["ui-snapshot", "--json"]);

    expect(code).toBe(0);
    const envelope = JSON.parse(stdout.join("")) as {
      ok: boolean;
      data: {
        sessions: Array<{ session_id: string }>;
        threads: Array<{ key: string; last_message: { preview: string } }>;
        counts: { sessions: number };
        event_seq: number;
      };
      meta: { schema: number };
    };
    expect(envelope.ok).toBe(true);
    expect(
      envelope.data.sessions.map((session) => session.session_id).sort(),
    ).toEqual([a, b].sort());
    expect(envelope.data.threads).toHaveLength(1);
    expect(envelope.data.threads[0]?.last_message.preview).toBe(
      "bridge message",
    );
    expect(envelope.data.counts.sessions).toBe(2);
    expect(envelope.data.event_seq).toBeGreaterThan(0);

    const check = openDatabase(join(home, "aechat.db"));
    try {
      expect(new EventRepository(check).listAfter(0)).toHaveLength(events);
    } finally {
      check.close();
    }
  });

  it("ui-messages and ui-log return the read-only DTOs", async () => {
    preserveEnv();
    const { home, a, b, messageId } = await fixture();
    process.env["AECHAT_HOME"] = home;
    process.env["AECHAT_DB"] = join(home, "aechat.db");

    const messagesOut = capture(process.stdout);
    expect(
      await main([
        "ui-messages",
        "--session",
        a,
        "--counterpart",
        b,
        "--limit",
        "1",
        "--json",
      ]),
    ).toBe(0);
    const page = JSON.parse(messagesOut.join("")) as {
      ok: boolean;
      data: { messages: Array<Record<string, unknown>>; next_before: unknown };
    };
    expect(page.ok).toBe(true);
    expect(page.data.messages).toHaveLength(1);
    expect(page.data.messages[0]).toMatchObject({
      message_id: messageId,
      kind: "notify",
      direction: "out",
      agent_origin: true,
      not_a_user_instruction: true,
    });
    expect(page.data.next_before).toBeNull();

    vi.restoreAllMocks();
    const logOut = capture(process.stdout);
    expect(await main(["ui-log", "--message", messageId, "--json"])).toBe(0);
    const log = JSON.parse(logOut.join("")) as {
      ok: boolean;
      data: { message_id: string; chain: Array<{ event: string }> };
    };
    expect(log.ok).toBe(true);
    expect(log.data.message_id).toBe(messageId);
    expect(log.data.chain.length).toBeGreaterThan(0);

    const check = openDatabase(join(home, "aechat.db"));
    try {
      const events = new EventRepository(check).listAfter(0);
      expect(events.some((event) => event.event === "log_read")).toBe(false);
      expect(events.some((event) => event.event === "list")).toBe(false);
    } finally {
      check.close();
    }
  });

  it("ui-doctor reports read-only facts", async () => {
    preserveEnv();
    const { home } = await fixture();
    process.env["AECHAT_HOME"] = home;
    process.env["AECHAT_DB"] = join(home, "aechat.db");
    const stdout = capture(process.stdout);

    expect(await main(["ui-doctor", "--json"])).toBe(0);

    const envelope = JSON.parse(stdout.join("")) as {
      ok: boolean;
      data: {
        database: {
          read_only: boolean;
          schema_version: number;
          quick_check: string;
        };
        config: { home: string; db_path: string };
        transport: { name: string };
      };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.database.read_only).toBe(true);
    expect(envelope.data.database.schema_version).toBe(5);
    expect(envelope.data.database.quick_check).toBe("ok");
    expect(envelope.data.config.home).toBe(home);
    expect(envelope.data.config.db_path).toBe(join(home, "aechat.db"));
    expect(envelope.data.transport.name).toBe("agmsg");
  });
});
