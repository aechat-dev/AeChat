import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../../src/cli/commands/context.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { setupCommand } from "../../src/cli/commands/setup.js";

const keys = [
  "AECHAT_HOME",
  "CLAUDE_CONFIG_DIR",
  "CODEX_HOME",
  "HOME",
  "PATH",
] as const;
const saved = new Map<string, string | undefined>();
const roots: string[] = [];

function ctx(): CommandContext {
  return { agmsgVersion: async () => "1.7.1" } as unknown as CommandContext;
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-init-"));
  roots.push(root);
  return root;
}

function setEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

for (const key of keys) {
  saved.set(key, process.env[key]);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  for (const key of keys) {
    const value = saved.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("init and setup", () => {
  it("creates the store and installs skills for detected hosts", async () => {
    const root = tempRoot();
    const home = join(root, "home");
    const claude = join(root, "claude");
    const codex = join(root, "codex");
    mkdirSync(claude, { recursive: true });
    mkdirSync(codex, { recursive: true });
    setEnv({
      AECHAT_HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: codex,
      PATH: "",
    });

    const result = await initCommand(["--json"], ctx());
    const data = result.data as {
      database: string;
      agmsg: { ok: boolean };
      hosts: Array<{ host: string; action: string; path: string }>;
    };

    expect(existsSync(data.database)).toBe(true);
    expect(data.agmsg.ok).toBe(true);
    expect(data.hosts.map((entry) => entry.host)).toEqual([
      "claude-code",
      "codex",
    ]);
    for (const entry of data.hosts) {
      expect(entry.action).toBe("installed");
      expect(existsSync(entry.path)).toBe(true);
    }
  });

  it("returns an up-to-date setup result on a second run", async () => {
    const root = tempRoot();
    setEnv({
      AECHAT_HOME: join(root, "home"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
      PATH: "",
    });
    mkdirSync(join(root, "claude"), { recursive: true });

    await initCommand(["--json"], ctx());
    const result = await setupCommand(["claude-code", "--json"], ctx());
    expect(result.data).toMatchObject({
      action: "up-to-date",
      host: "claude-code",
    });
  });

  it("prints human-readable next steps without --json", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "claude"), { recursive: true });
    setEnv({
      AECHAT_HOME: join(root, "home"),
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
      PATH: "",
    });

    const result = await initCommand([], ctx());
    expect(result.text).toContain("AeChat initialized");
    expect(result.text).toContain("claude-code skill: installed");
    expect(result.text).toContain("aechat register");
  });
});
