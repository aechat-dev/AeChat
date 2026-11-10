import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  codexExecutable,
  codexHooksPath,
  installAttachHook,
  installCodexHooks,
  queueCodexMessage,
  removeAttachHook,
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

/** agmsgd is unavailable, so setup falls back to the monitor hooks path. */
async function noAgmsgd(file: string, args: readonly string[]) {
  if (file.endsWith("/agmsg") && args[0] === "daemon") {
    return { exitCode: 0, stdout: "agmsgd=unavailable\n", stderr: "" };
  }
  return { exitCode: 0, stdout: "", stderr: "" };
}

function writeHooks(root: string): void {
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(
    codexHooksPath(root),
    JSON.stringify({
      hooks: { SessionStart: [{ command: "agmsg session-start.sh" }] },
    }),
  );
}

describe("codex delivery setup", () => {
  it("prefers agmsgd when it is available", async () => {
    const root = project();
    const calls: string[][] = [];
    const runner = async (file: string, args: readonly string[]) => {
      calls.push([file, ...args]);
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=available\n", stderr: "" };
      }
      if (args[0] === "delivery" && args[1] === "agmsgd") {
        writeHooks(root);
        return { exitCode: 0, stdout: "Delivery mode set\n", stderr: "" };
      }
      if (args[0] === "delivery" && args[1] === "status") {
        return {
          exitCode: 0,
          stdout: "this project: agmsgd — no Monitor is armed here\n",
          stderr: "",
        };
      }
      throw new Error(`unexpected call: ${file} ${args.join(" ")}`);
    };

    const result = await installCodexHooks({ project: root, runner });

    expect(result).toEqual({
      action: "configured",
      mode: "agmsgd",
      path: codexHooksPath(root),
      attachHook: "skipped",
    });
    expect(calls.some((call) => call.includes("agmsgd"))).toBe(true);
    expect(existsSync(codexHooksPath(root))).toBe(true);
  });

  it("starts agmsgd when it is enabled but not running", async () => {
    const root = project();
    const calls: string[][] = [];
    const runner = async (_file: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=not-running\n", stderr: "" };
      }
      if (args[0] === "delivery" && args[1] === "agmsgd") {
        writeHooks(root);
        return { exitCode: 0, stdout: "started\n", stderr: "" };
      }
      return {
        exitCode: 0,
        stdout: "this project: agmsgd\n",
        stderr: "",
      };
    };

    const result = await installCodexHooks({ project: root, runner });

    expect(result.mode).toBe("agmsgd");
    expect(calls.some((call) => call[1] === "agmsgd")).toBe(true);
  });

  it("fails when agmsgd leaves no SessionStart hook", async () => {
    const root = project();
    const runner = async (_file: string, args: readonly string[]) => {
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=available\n", stderr: "" };
      }
      if (args[0] === "delivery" && args[1] === "agmsgd") {
        return { exitCode: 0, stdout: "ok\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "this project: agmsgd\n", stderr: "" };
    };

    await expect(installCodexHooks({ project: root, runner })).rejects.toThrow(
      "SessionStart hook file is missing",
    );
  });

  it("fails when agmsgd does not take the project", async () => {
    const root = project();
    const runner = async (_file: string, args: readonly string[]) => {
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=available\n", stderr: "" };
      }
      if (args[0] === "delivery" && args[1] === "agmsgd") {
        return { exitCode: 0, stdout: "ok\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "this project: off\n", stderr: "" };
    };

    await expect(installCodexHooks({ project: root, runner })).rejects.toThrow(
      "not on agmsgd delivery",
    );
  });

  it("reports a dry run without writing hooks", async () => {
    const root = project();

    const result = await installCodexHooks({
      project: root,
      dryRun: true,
      runner: noAgmsgd,
    });

    expect(result.action).toBe("would-configure");
    expect(result.mode).toBe("monitor");
    expect(existsSync(codexHooksPath(root))).toBe(false);
  });

  it("configures agmsg monitor hooks when agmsgd is unavailable", async () => {
    const root = project();
    const calls: string[][] = [];
    const runner = async (file: string, args: readonly string[]) => {
      calls.push([file, ...args]);
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=unavailable\n", stderr: "" };
      }
      writeHooks(root);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const result = await installCodexHooks({ project: root, runner });

    expect(result).toEqual({
      action: "configured",
      mode: "monitor",
      path: codexHooksPath(root),
      attachHook: "skipped",
    });
    expect(calls.some((call) => call.includes("monitor"))).toBe(true);
  });

  it("resolves delivery.sh from AGMSG_HOME", async () => {
    const root = project();
    const agmsgHome = join(root, "agmsg-home");
    const calls: string[] = [];
    const runner = async (file: string, _args: readonly string[]) => {
      calls.push(file);
      if (file.endsWith("delivery.sh")) {
        writeHooks(root);
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    await installCodexHooks({
      project: root,
      env: { AGMSG_HOME: agmsgHome },
      runner,
    });

    expect(calls).toContain(join(agmsgHome, "scripts", "delivery.sh"));
  });

  it("fails when agmsg succeeds without writing hooks", async () => {
    const root = project();

    await expect(
      installCodexHooks({ project: root, runner: noAgmsgd }),
    ).rejects.toThrow("is missing");
  });

  it("is idempotent when the hooks already mention agmsg", async () => {
    const root = project();
    writeHooks(root);

    const result = await installCodexHooks({
      project: root,
      runner: async (file: string, args: readonly string[]) => {
        if (args[0] === "daemon") {
          return { exitCode: 0, stdout: "agmsgd=unavailable\n", stderr: "" };
        }
        throw new Error(`runner must not configure: ${file}`);
      },
    });

    expect(result.action).toBe("up-to-date");
    expect(result.mode).toBe("monitor");
  });

  it("appends AeChat's attach hook without dropping agmsg's entry", () => {
    const root = project();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      codexHooksPath(root),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "agmsg session-start.sh" }],
            },
          ],
        },
      }),
    );
    const command = "node cli.js attach --client codex --project /p";

    expect(installAttachHook(codexHooksPath(root), command)).toBe("installed");
    expect(installAttachHook(codexHooksPath(root), command)).toBe("up-to-date");

    const parsed = JSON.parse(readFileSync(codexHooksPath(root), "utf8")) as {
      hooks: { SessionStart: unknown[] };
    };
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    expect(JSON.stringify(parsed)).toContain("agmsg session-start.sh");
    expect(JSON.stringify(parsed)).toContain("attach --client codex");
  });

  it("removes only AeChat's attach entry and keeps agmsg's", () => {
    const root = project();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      codexHooksPath(root),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node cli.js attach --client codex --project /p",
                },
              ],
            },
            {
              matcher: "",
              hooks: [{ type: "command", command: "agmsg session-start.sh" }],
            },
          ],
        },
      }),
    );

    expect(removeAttachHook(codexHooksPath(root), true)).toBe("would-remove");
    expect(removeAttachHook(codexHooksPath(root))).toBe("removed");
    expect(removeAttachHook(codexHooksPath(root))).toBe("absent");

    const parsed = JSON.parse(readFileSync(codexHooksPath(root), "utf8")) as {
      hooks: { SessionStart: unknown[] };
    };
    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(parsed)).toContain("agmsg session-start.sh");
    expect(JSON.stringify(parsed)).not.toContain("attach --client codex");
  });

  it("replaces a stale AeChat attach command in place", () => {
    const root = project();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      codexHooksPath(root),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "",
              hooks: [{ type: "command", command: "agmsg session-start.sh" }],
            },
            {
              matcher: "",
              hooks: [
                {
                  type: "command",
                  command: "node old/cli.js attach --client codex",
                },
              ],
            },
          ],
        },
      }),
    );
    const command = "node new/cli.js attach --client codex";

    expect(installAttachHook(codexHooksPath(root), command)).toBe("installed");

    const parsed = JSON.parse(readFileSync(codexHooksPath(root), "utf8")) as {
      hooks: { SessionStart: unknown[] };
    };
    expect(parsed.hooks.SessionStart).toHaveLength(2);
    const text = JSON.stringify(parsed);
    expect(text).toContain("new/cli.js");
    expect(text).not.toContain("old/cli.js");
    expect(text).toContain("agmsg session-start.sh");
  });

  it("skips malformed hooks files instead of throwing", () => {
    const root = project();
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(codexHooksPath(root), "{not json");

    expect(
      installAttachHook(
        codexHooksPath(root),
        "node cli.js attach --client codex",
      ),
    ).toBe("skipped");
    expect(readFileSync(codexHooksPath(root), "utf8")).toBe("{not json");
  });

  it("fails when agmsg cannot configure the project", async () => {
    const root = project();
    const runner = async (_file: string, args: readonly string[]) => {
      if (args[0] === "daemon") {
        return { exitCode: 0, stdout: "agmsgd=unavailable\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "no agmsg" };
    };

    await expect(installCodexHooks({ project: root, runner })).rejects.toThrow(
      "no agmsg",
    );
  });
});

describe("queueCodexMessage", () => {
  const thread = "01a1aeb5-55d4-79c3-bfa7-e1d96c4fd2e5";

  it("queues the body as a user turn in the thread", async () => {
    const calls: string[][] = [];
    const result = await queueCodexMessage(
      { thread, body: "hello from AeChat" },
      {
        executable: "/opt/codex",
        runner: async (file, args) => {
          calls.push([file, ...args]);
          return { exitCode: 0, stdout: "queued", stderr: "" };
        },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      [
        "/opt/codex",
        "queue",
        "--thread",
        thread,
        "--message=hello from AeChat",
      ],
    ]);
  });

  it("passes a body starting with a dash as one option value", async () => {
    const calls: string[][] = [];
    await queueCodexMessage(
      { thread, body: "- list item" },
      {
        executable: "/opt/codex",
        runner: async (_file, args) => {
          calls.push([...args]);
          return { exitCode: 0, stdout: "queued", stderr: "" };
        },
      },
    );

    expect(calls[0]).toEqual([
      "queue",
      "--thread",
      thread,
      "--message=- list item",
    ]);
  });

  it("reports the CLI error instead of falling back to a pointer", async () => {
    const result = await queueCodexMessage(
      { thread, body: "hello" },
      {
        executable: "/opt/codex",
        runner: async () => ({
          exitCode: 127,
          stdout: "",
          stderr: "queue_exit_127",
        }),
      },
    );

    expect(result).toEqual({ ok: false, error: "queue_exit_127" });
  });

  it("rejects a non-thread id and an empty body before exec", async () => {
    const runner = async () => {
      throw new Error("must not run");
    };
    await expect(
      queueCodexMessage(
        { thread: "not-a-uuid", body: "hello" },
        { executable: "/opt/codex", runner },
      ),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      queueCodexMessage(
        { thread, body: "" },
        { executable: "/opt/codex", runner },
      ),
    ).resolves.toMatchObject({ ok: false });
  });

  it("names the missing executable", async () => {
    const result = await queueCodexMessage(
      { thread, body: "hello" },
      { executable: "" },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("AECHAT_CODEX_BIN");
  });

  it("prefers AECHAT_CODEX_BIN over the bundled app path", () => {
    expect(codexExecutable({ AECHAT_CODEX_BIN: "/custom/codex" })).toBe(
      "/custom/codex",
    );
  });
});
