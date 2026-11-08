import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";
import { createRuntime } from "../../src/runtime/runtime.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "aechat-runtime-"));
  dirs.push(home);
  return home;
}

describe("createRuntime", () => {
  it("builds every service from one composition root", async () => {
    const home = tempHome();
    const runtime = createRuntime({
      home,
      transport: new FakeTransportAdapter(),
      now: () => "2026-11-07T00:00:00.000Z",
    });

    try {
      expect(runtime.service).toBeDefined();
      expect(runtime.delivery).toBeDefined();
      expect(runtime.request).toBeDefined();
      expect(runtime.resume).toBeDefined();
      expect(runtime.capabilities).toBeDefined();
      expect(runtime.audit).toBeDefined();
      expect(runtime.sessionQuery).toBeDefined();
      expect(runtime.sessions).toBeDefined();
      expect(runtime.events).toBeDefined();

      const result = await runtime.service.register({
        displayName: "runtime",
        client: "claude-code",
        project: "/tmp/runtime",
      });
      expect(result.session.sessionId).toBe(result.binding.sessionId);
      expect(runtime.sessions.get(result.session.sessionId)).toBeDefined();
    } finally {
      runtime.close();
    }
  });

  it("closes the database with the runtime", () => {
    const runtime = createRuntime({
      home: tempHome(),
      transport: new FakeTransportAdapter(),
      now: () => "2026-11-07T00:00:00.000Z",
    });

    runtime.close();

    expect(() => runtime.sessions.list()).toThrow();
  });
});
