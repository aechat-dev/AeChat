import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { CommandContext } from "../../src/cli/commands/context.js";
import { initCommand } from "../../src/cli/commands/init.js";
import { setupCommand } from "../../src/cli/commands/setup.js";
import { main } from "../../src/cli/main.js";

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
    const result = await setupCommand(["claude-code", "--json"]);
    expect(result.data).toMatchObject({
      action: "up-to-date",
      host: "claude-code",
    });
  });

  it("rejects --hooks for hosts without an agmsg hook installer", async () => {
    await expect(
      setupCommand(["claude-code", "--hooks", "--json"]),
    ).rejects.toThrow("only codex has an agmsg hook installer");
  });

  it("reports planned actions in a dry run without touching the disk", async () => {
    const root = tempRoot();
    const home = join(root, "home");
    const claude = join(root, "claude");
    mkdirSync(claude, { recursive: true });
    setEnv({
      AECHAT_HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: join(root, "codex"),
      PATH: "",
    });

    const result = await initCommand(["--json", "--dry-run"], ctx());
    const data = result.data as {
      dry_run: boolean;
      hosts: Array<{ action: string; dry_run: boolean; path: string }>;
    };

    expect(data.dry_run).toBe(true);
    expect(data.hosts[0]).toMatchObject({
      action: "would-install",
      dry_run: true,
    });
    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(claude, "skills"))).toBe(false);
  });

  it("dispatches init/setup dry runs before opening the store", async () => {
    const root = tempRoot();
    const home = join(root, "home");
    const claude = join(root, "claude");
    mkdirSync(claude, { recursive: true });
    setEnv({
      AECHAT_HOME: home,
      CLAUDE_CONFIG_DIR: claude,
      CODEX_HOME: join(root, "codex"),
      PATH: "",
    });

    const writes: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
      );
      return true;
    }) as typeof process.stdout.write;
    try {
      expect(await main(["init", "--dry-run", "--json"])).toBe(0);
      expect(await main(["setup", "claude-code", "--dry-run", "--json"])).toBe(
        0,
      );
    } finally {
      process.stdout.write = original;
    }

    expect(existsSync(home)).toBe(false);
    expect(existsSync(join(claude, "skills"))).toBe(false);
    const init = JSON.parse(writes[0] ?? "") as {
      data: { dry_run: boolean };
    };
    expect(init.data.dry_run).toBe(true);
    const setup = JSON.parse(writes[1] ?? "") as {
      data: { action: string; dry_run: boolean };
    };
    expect(setup.data).toMatchObject({
      action: "would-install",
      dry_run: true,
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
