import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  detectHosts,
  hostPaths,
  installHostSkill,
} from "../../src/runtime/host-install.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-host-install-"));
  roots.push(root);
  return root;
}

function sourceWithSkills(root: string): string {
  const source = join(root, "skills");
  for (const host of ["claude-code", "codex"]) {
    mkdirSync(join(source, host), { recursive: true });
    writeFileSync(join(source, host, "SKILL.md"), `# ${host} skill\n`);
  }
  return source;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("host skill installation", () => {
  it("resolves per-host config directories from the environment", () => {
    const root = tempRoot();
    const env = {
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
    };
    expect(hostPaths("claude-code", env).skillFile).toBe(
      join(root, "claude", "skills", "aechat", "SKILL.md"),
    );
    expect(hostPaths("codex", env).skillFile).toBe(
      join(root, "codex", "skills", "aechat", "SKILL.md"),
    );
  });

  it("treats empty config directory overrides as unset", () => {
    expect(hostPaths("claude-code", { CLAUDE_CONFIG_DIR: "" }).skillFile).toBe(
      join(homedir(), ".claude", "skills", "aechat", "SKILL.md"),
    );
    expect(hostPaths("codex", { CODEX_HOME: "" }).skillFile).toBe(
      join(homedir(), ".codex", "skills", "aechat", "SKILL.md"),
    );
  });

  it("installs, reports up-to-date, and refreshes a changed skill", () => {
    const root = tempRoot();
    const sourceRoot = sourceWithSkills(root);
    const env = {
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
    };

    const first = installHostSkill({ host: "claude-code", sourceRoot, env });
    expect(first.action).toBe("installed");
    expect(readFileSync(first.path, "utf8")).toContain("claude-code skill");

    const second = installHostSkill({ host: "claude-code", sourceRoot, env });
    expect(second.action).toBe("up-to-date");

    writeFileSync(first.path, "stale\n");
    const third = installHostSkill({ host: "claude-code", sourceRoot, env });
    expect(third.action).toBe("updated");
    expect(readFileSync(first.path, "utf8")).toContain("claude-code skill");
  });

  it("does not write during a dry run", () => {
    const root = tempRoot();
    const sourceRoot = sourceWithSkills(root);
    const env = {
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
    };
    const result = installHostSkill({
      host: "codex",
      sourceRoot,
      env,
      dryRun: true,
    });
    expect(result.action).toBe("would-install");
    expect(result.dry_run).toBe(true);
    expect(() => readFileSync(result.path, "utf8")).toThrow();
  });

  it("detects hosts by config directory", () => {
    const root = tempRoot();
    mkdirSync(join(root, "claude"), { recursive: true });
    const env = {
      CLAUDE_CONFIG_DIR: join(root, "claude"),
      CODEX_HOME: join(root, "codex"),
      PATH: "",
    };
    expect(detectHosts(env)).toEqual(["claude-code"]);
  });
});
