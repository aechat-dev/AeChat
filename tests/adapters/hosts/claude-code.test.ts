import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installClaudeHook } from "../../../src/adapters/hosts/claude-code.js";

const roots: string[] = [];

function settingsFile(): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-claude-hook-"));
  roots.push(root);
  mkdirSync(root, { recursive: true });
  return join(root, "settings.json");
}

function read(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("installClaudeHook", () => {
  const command = "node cli.js attach --client claude-code --stdin-session";

  it("preserves unrelated settings and other hook events", () => {
    const path = settingsFile();
    writeFileSync(
      path,
      JSON.stringify({
        model: "opus",
        hooks: { PreToolUse: [{ matcher: "", hooks: [] }] },
      }),
    );

    expect(installClaudeHook({ settingsPath: path, command })).toMatchObject({
      action: "installed",
    });

    const parsed = read(path) as {
      model: string;
      hooks: {
        PreToolUse: unknown[];
        SessionStart: Array<{ hooks: Array<{ command: string }> }>;
      };
    };
    expect(parsed.model).toBe("opus");
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0]?.hooks[0]?.command).toBe(command);
    expect(installClaudeHook({ settingsPath: path, command }).action).toBe(
      "up-to-date",
    );
  });

  it("replaces a stale AeChat command in place", () => {
    const path = settingsFile();
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "old attach --client claude-code --project /p",
                },
              ],
            },
          ],
        },
      }),
    );

    expect(installClaudeHook({ settingsPath: path, command }).action).toBe(
      "installed",
    );
    const parsed = read(path) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0]?.hooks[0]?.command).toBe(command);
  });

  it("does not write during a dry run", () => {
    const path = settingsFile();
    expect(
      installClaudeHook({ settingsPath: path, command, dryRun: true }).action,
    ).toBe("would-install");
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("skips a non-object settings file", () => {
    const path = settingsFile();
    writeFileSync(path, "[]");
    expect(installClaudeHook({ settingsPath: path, command }).action).toBe(
      "skipped",
    );
    expect(readFileSync(path, "utf8")).toBe("[]");
  });

  it("skips a malformed settings file instead of overwriting it", () => {
    const path = settingsFile();
    writeFileSync(path, "{not json");
    expect(installClaudeHook({ settingsPath: path, command }).action).toBe(
      "skipped",
    );
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });
});
