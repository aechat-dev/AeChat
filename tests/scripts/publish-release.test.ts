import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/publish-release.sh", import.meta.url),
);
const roots: string[] = [];

const fakeGh = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = "release" ] && [ "$2" = "view" ]; then
  case "\${GH_STATE:-missing}" in
    draft) printf 'true\\n'; exit 0 ;;
    published) printf 'false\\n'; exit 0 ;;
    error) printf 'HTTP 500\\n' >&2; exit 1 ;;
    *) printf 'release not found\\n' >&2; exit 1 ;;
  esac
fi
exit 0
`;

function setup(): { root: string; bin: string; log: string } {
  const root = mkdtempSync(join(tmpdir(), "aechat-publish-"));
  roots.push(root);
  const bin = join(root, "bin");
  const log = join(root, "gh.log");
  writeFileSync(join(root, "notes.md"), "notes");
  writeFileSync(join(root, "asset.tgz"), "asset");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), fakeGh);
  chmodSync(join(bin, "gh"), 0o755);
  return { root, bin, log };
}

function run(
  root: string,
  bin: string,
  log: string,
  state: string,
  tag = "v0.1.0-alpha.1",
) {
  return spawnSync(
    "bash",
    [script, tag, join(root, "notes.md"), join(root, "asset.tgz")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_STATE: state,
        GH_LOG: log,
      },
    },
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("publish release", () => {
  it("creates a draft, uploads with clobber, then publishes", () => {
    const { root, bin, log } = setup();
    const result = run(root, bin, log, "missing");

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls[0]).toContain("release view");
    expect(calls[1]).toContain("release create");
    expect(calls[1]).toContain("--draft");
    expect(calls[1]).toContain("--prerelease");
    expect(calls[2]).toContain("release upload");
    expect(calls[2]).toContain("--clobber");
    expect(calls[3]).toContain("release edit");
    expect(calls[3]).toContain("--draft=false");
  });

  it("publishes a stable tag without a prerelease flag", () => {
    const { root, bin, log } = setup();
    const result = run(root, bin, log, "missing", "v1.0.0");

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    const create = calls.find((call) => call.includes("release create"));
    expect(create).toContain("--draft");
    expect(create).not.toContain("--prerelease");
    expect(calls.at(-1)).toContain("--draft=false");
  });

  it("resumes an existing draft without creating it again", () => {
    const { root, bin, log } = setup();
    const result = run(root, bin, log, "draft");

    expect(result.status).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.some((call) => call.includes("release create"))).toBe(false);
    const notesIndex = calls.findIndex(
      (call) =>
        call.includes("release edit") &&
        call.includes("--title") &&
        call.includes("--notes-file"),
    );
    const uploadIndex = calls.findIndex((call) =>
      call.includes("release upload"),
    );
    expect(notesIndex).toBeGreaterThan(-1);
    expect(notesIndex).toBeLessThan(uploadIndex);
    expect(calls[notesIndex]).toContain("--prerelease");
    expect(calls.at(-1)).toContain("release edit");
    expect(calls.at(-1)).toContain("--draft=false");
  });

  it("stops on a non-not-found release lookup error", () => {
    const { root, bin, log } = setup();
    const result = run(root, bin, log, "error");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTP 500");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("release view");
  });

  it("refuses to touch an already published release", () => {
    const { root, bin, log } = setup();
    const result = run(root, bin, log, "published");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("already published");
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("release view");
  });
});
