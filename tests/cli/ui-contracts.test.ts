import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createReadOnlyRuntime } from "../../src/app/read-only-runtime.js";
import { createRuntime } from "../../src/app/runtime.js";
import { listCommand } from "../../src/cli/commands/list.js";
import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
} from "../../src/contracts/envelope.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";

const dirs: string[] = [];
const runtimes: Array<{ close(): void }> = [];

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function setup(): {
  home: string;
  dbPath: string;
  runtime: ReturnType<typeof createRuntime>;
} {
  const home = mkdtempSync(join(tmpdir(), "aechat-contracts-"));
  dirs.push(home);
  const dbPath = join(home, "aechat.db");
  const runtime = createRuntime({
    home,
    dbPath,
    transport: new FakeTransportAdapter(),
    now: () => "2026-11-07T00:00:00.000Z",
  });
  runtimes.push(runtime);
  return { home, dbPath, runtime };
}

describe("ui contracts", () => {
  it("list and sessionQuery share one SessionView shape", async () => {
    const { runtime } = setup();
    await runtime.service.register({
      displayName: "contracts",
      client: "claude-code",
      project: "/tmp/contracts",
    });

    const command = await listCommand([], runtime);
    const query = await runtime.sessionQuery.list();

    const withoutClock = (views: typeof query) =>
      views.map(({ evidence_at: _evidenceAt, ...rest }) => rest);
    expect(withoutClock(command["sessions"] as typeof query)).toEqual(
      withoutClock(query),
    );
    expect(query[0]).toMatchObject({
      session_id: expect.any(String),
      display_name: "contracts",
      status: expect.any(String),
      status_evidence: expect.any(String),
      bound_state: expect.any(String),
      capabilities: expect.any(Object),
    });
  });

  it("the read-only bridge returns the same view as the CLI", async () => {
    const { home, dbPath, runtime } = setup();
    await runtime.service.register({
      displayName: "same-store",
      client: "codex",
      project: "/tmp/same-store",
    });
    const cliView = await runtime.sessionQuery.list();
    runtime.close();
    runtimes.pop();

    const readOnly = createReadOnlyRuntime({
      home,
      dbPath,
      transport: new FakeTransportAdapter(),
      now: () => "2026-11-07T00:00:00.000Z",
    });
    runtimes.push(readOnly);
    const bridgeView = await readOnly.sessionQuery.list();

    const withoutClock = (views: typeof cliView) =>
      views.map(({ evidence_at: _evidenceAt, ...rest }) => rest);
    expect(withoutClock(bridgeView)).toEqual(withoutClock(cliView));
  });
});

describe("envelope contract", () => {
  it("stamps schema 1 and cannot be overridden by callers", () => {
    expect(buildSuccessEnvelope({ a: 1 }, { schema: 99 })).toEqual({
      ok: true,
      data: { a: 1 },
      meta: { schema: 1 },
    });
    expect(buildSuccessEnvelope({ a: 1 }, { cursor: 7 })).toEqual({
      ok: true,
      data: { a: 1 },
      meta: { cursor: 7, schema: 1 },
    });
  });

  it("includes details only when provided", () => {
    expect(buildErrorEnvelope("invalid_input", "bad")).toEqual({
      ok: false,
      error: { code: "invalid_input", message: "bad" },
      meta: { schema: 1 },
    });
    expect(
      buildErrorEnvelope("invalid_input", "bad", { field: "name" }),
    ).toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "bad",
        details: { field: "name" },
      },
      meta: { schema: 1 },
    });
  });
});
