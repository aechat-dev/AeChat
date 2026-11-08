import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { HOSTS, hostHookPaths } from "../../../src/adapters/hosts/registry.js";

describe("host hook paths", () => {
  it("resolves every host hook file inside its config directory", () => {
    const env = {
      CLAUDE_CONFIG_DIR: "/tmp/claude-config",
      CODEX_HOME: "/tmp/codex-home",
    };

    expect(hostHookPaths(env)).toEqual([
      join("/tmp/claude-config", "settings.json"),
      join("/tmp/codex-home", "config.toml"),
    ]);
  });

  it("falls back to the default config directories", () => {
    expect(hostHookPaths({})).toEqual([
      join(homedir(), ".claude", "settings.json"),
      join(homedir(), ".codex", "config.toml"),
    ]);
  });

  it("declares a hook file for every built-in host", () => {
    for (const host of HOSTS) {
      expect(host.hookFile).not.toBe("");
    }
  });
});
