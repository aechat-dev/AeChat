import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const root = join(repo, "plugins", "aechat-codex");
const script = join(root, "scripts", "session-start.mjs");
const wrapper = join(root, "scripts", "session-start.sh");
const thread = "01a1aeb5-55d4-79c3-bfa7-e1d96c4fd2e5";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function fakeBinary(dir: string, body: string): string {
  const path = join(dir, "aechat");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

describe("Codex plugin hook", () => {
  it("is a plugin with a SessionStart hook that runs the script", () => {
    const plugin = json(join(root, ".claude-plugin", "plugin.json"));
    const marketplace = json(join(root, ".claude-plugin", "marketplace.json"));
    const hooks = json(join(root, "hooks", "hooks.json")) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };

    expect(plugin["name"]).toBe("aechat-codex");
    expect(JSON.stringify(marketplace)).toContain("aechat-codex");
    expect(hooks.hooks.SessionStart[0]?.hooks[0]?.command).toContain(
      "session-start.sh",
    );
  });

  it("ships in the npm package so an installed CLI can find it", () => {
    const pkg = json(join(repo, "package.json")) as { files: string[] };
    expect(pkg.files).toContain("plugins");
    expect(() =>
      statSync(join(root, ".claude-plugin", "marketplace.json")),
    ).not.toThrow();
  });

  it("forwards the payload on stdin and passes --stdin-session", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "capture");
    const input = join(dir, "stdin");
    const fake = fakeBinary(
      dir,
      `printf '%s' "$*" > '${capture}'\ncat > '${input}'`,
    );

    const payload = JSON.stringify({ session_id: thread, cwd: "/tmp/project" });
    const result = spawnSync("node", [script], {
      input: payload,
      encoding: "utf8",
      env: {
        ...process.env,
        AECHAT_BIN: fake,
        AECHAT_HOME: dir,
        AGMSG_SESSION_ID: "wrong-session",
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toBe(
      "attach --client codex --project /tmp/project --stdin-session --json",
    );
    expect(readFileSync(input, "utf8")).toBe(payload);
    const log = readFileSync(join(dir, "logs", "codex-session-start.log"));
    expect(
      statSync(join(dir, "logs", "codex-session-start.log")).mode & 0o777,
    ).toBe(0o600);
    expect(log.toString()).toContain(`session=${thread}`);
  });

  it("still runs attach when the payload has no session id", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "capture");
    const input = join(dir, "stdin");
    const fake = fakeBinary(
      dir,
      `printf '%s' "$*" > '${capture}'\ncat > '${input}'`,
    );

    const result = spawnSync("node", [script], {
      input: JSON.stringify({ cwd: "/tmp/project" }),
      encoding: "utf8",
      env: {
        ...process.env,
        AECHAT_BIN: fake,
        AECHAT_HOME: dir,
        CODEX_THREAD_ID: "env-thread",
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toContain("--stdin-session");
    expect(readFileSync(input, "utf8")).toBe(
      JSON.stringify({ cwd: "/tmp/project" }),
    );
  });

  it("does not fail the host when attach cannot start", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const result = spawnSync("node", [script], {
      input: JSON.stringify({ session_id: thread, cwd: "/tmp/project" }),
      encoding: "utf8",
      env: {
        ...process.env,
        AECHAT_BIN: join(dir, "missing-aechat"),
        AECHAT_HOME: dir,
      },
    });

    expect(result.status).toBe(0);
    expect(
      readFileSync(join(dir, "logs", "codex-session-start.log"), "utf8"),
    ).toContain("exit=null");
  });

  it("runs the wrapper from a minimal shell and keeps the payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "capture");
    const input = join(dir, "stdin");
    const fake = fakeBinary(
      dir,
      `printf '%s' "$*" > '${capture}'\ncat > '${input}'`,
    );
    const payload = JSON.stringify({ session_id: thread, cwd: "/tmp/project" });

    const result = spawnSync("/bin/sh", [wrapper], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, AECHAT_BIN: fake, AECHAT_HOME: dir },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(input, "utf8")).toBe(payload);
    expect(readFileSync(capture, "utf8")).toContain("--stdin-session");
  });

  it("honors AECHAT_NODE_BIN when PATH has no node", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "node-calls");
    const fakeNode = join(dir, "node");
    writeFileSync(fakeNode, `#!/bin/sh\nprintf '%s' "$*" > '${capture}'\n`);
    chmodSync(fakeNode, 0o755);

    const result = spawnSync("/bin/sh", [wrapper], {
      input: JSON.stringify({ session_id: thread, cwd: "/tmp/project" }),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: dir,
        PATH: "/usr/bin:/bin",
        AECHAT_HOME: dir,
        AECHAT_NODE_BIN: fakeNode,
      },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toBe(script);
  });
});
