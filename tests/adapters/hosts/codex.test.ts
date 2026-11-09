import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  codexHooksPath,
  installCodexHooks,
} from "../../../src/adapters/hosts/codex.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-codex-hooks-"));
  roots.push(root);
  return root;
}

describe("codex hooks", () => {
  it("reports a dry run without writing hooks", async () => {
    const root = project();

    const result = await installCodexHooks({ project: root, dryRun: true });

    expect(result.action).toBe("would-configure");
    expect(existsSync(codexHooksPath(root))).toBe(false);
  });

  it("configures agmsg monitor hooks through delivery.sh", async () => {
    const root = project();
    const calls: string[][] = [];
    const runner = async (
      _file: string,
      args: readonly string[],
    ): Promise<{ exitCode: number; stderr: string }> => {
      calls.push([...args]);
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(
        codexHooksPath(root),
        JSON.stringify({
          hooks: { SessionStart: [{ command: "agmsg session-start.sh" }] },
        }),
      );
      return { exitCode: 0, stderr: "" };
    };

    const result = await installCodexHooks({ project: root, runner });

    expect(result.action).toBe("configured");
    expect(calls).toEqual([["set", "monitor", "codex", root]]);
  });

  it("resolves delivery.sh from AGMSG_HOME", async () => {
    const root = project();
    const agmsgHome = join(root, "agmsg-home");
    const calls: string[] = [];
    const runner = async (
      file: string,
      _args: readonly string[],
    ): Promise<{ exitCode: number; stderr: string }> => {
      calls.push(file);
      mkdirSync(join(root, ".codex"), { recursive: true });
      writeFileSync(
        codexHooksPath(root),
        '{"command":"agmsg session-start.sh"}',
      );
      return { exitCode: 0, stderr: "" };
    };

    await installCodexHooks({
      project: root,
      env: { AGMSG_HOME: agmsgHome },
      runner,
    });

    expect(calls).toEqual([join(agmsgHome, "scripts", "delivery.sh")]);
  });

  it("fails when agmsg succeeds without writing hooks", async () => {
    const root = project();

    await expect(
      installCodexHooks({
        project: root,
        runner: async () => ({ exitCode: 0, stderr: "" }),
      }),
    ).rejects.toThrow("is missing");
  });

  it("is idempotent when the hooks already mention agmsg", async () => {
    const root = project();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      codexHooksPath(root),
      JSON.stringify({ command: "agmsg session-start.sh" }),
    );

    const result = await installCodexHooks({
      project: root,
      runner: async () => {
        throw new Error("runner must not be called");
      },
    });

    expect(result.action).toBe("up-to-date");
  });

  it("fails when agmsg cannot configure the project", async () => {
    const root = project();

    await expect(
      installCodexHooks({
        project: root,
        runner: async () => ({ exitCode: 1, stderr: "no agmsg" }),
      }),
    ).rejects.toThrow("no agmsg");
  });
});
