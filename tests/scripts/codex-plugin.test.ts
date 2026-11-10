import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(
  new URL("../../plugins/aechat-codex", import.meta.url),
);
const script = join(root, "scripts", "session-start.mjs");
const thread = "01a1aeb5-55d4-79c3-bfa7-e1d96c4fd2e5";

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
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
      "session-start.mjs",
    );
  });

  it("passes the payload thread id and cwd to aechat", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "capture");
    const fake = join(dir, "aechat");
    writeFileSync(
      fake,
      `#!/bin/sh\nprintf '%s|%s' "$CODEX_THREAD_ID" "$*" > '${capture}'\n`,
    );
    chmodSync(fake, 0o755);

    const result = spawnSync("node", [script], {
      input: JSON.stringify({ session_id: thread, cwd: "/tmp/project" }),
      encoding: "utf8",
      env: { ...process.env, AECHAT_BIN: fake, AECHAT_HOME: dir },
    });

    expect(result.status).toBe(0);
    expect(readFileSync(capture, "utf8")).toBe(
      `${thread}|attach --client codex --project /tmp/project --json`,
    );
  });

  it("does nothing when the payload has no session id", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-plugin-"));
    const capture = join(dir, "capture");
    const fake = join(dir, "aechat");
    writeFileSync(fake, "#!/bin/sh\nprintf called > '" + capture + "'\n");
    chmodSync(fake, 0o755);

    const result = spawnSync("node", [script], {
      input: JSON.stringify({ cwd: "/tmp/project" }),
      encoding: "utf8",
      env: { ...process.env, AECHAT_BIN: fake, AECHAT_HOME: dir },
    });

    expect(result.status).toBe(0);
    expect(() => readFileSync(capture, "utf8")).toThrow();
  });
});
