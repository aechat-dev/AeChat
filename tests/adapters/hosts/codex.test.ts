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
