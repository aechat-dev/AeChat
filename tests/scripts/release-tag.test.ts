import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/verify-tag-on-main.sh", import.meta.url),
);
const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repository(): { remote: string; clone: string } {
  const root = mkdtempSync(join(tmpdir(), "aechat-release-tag-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  execFileSync("git", ["init", "--bare", remote]);
  execFileSync("git", ["clone", remote, clone]);
  git(clone, "config", "user.email", "check@example.invalid");
  git(clone, "config", "user.name", "check");
  return { remote, clone };
}

function commit(cwd: string, message: string): string {
  git(cwd, "commit", "--allow-empty", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release tag verification", () => {
  it("accepts a tag on an older main commit after main advances", () => {
    const { clone } = repository();
    git(clone, "branch", "-M", "main");
    const tagged = commit(clone, "first");
    git(clone, "push", "origin", "main");
    commit(clone, "second");
    git(clone, "push", "origin", "main");

    const result = spawnSync("bash", [script, tagged], {
      cwd: clone,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
  });

  it("rejects a commit that is not on main", () => {
    const { clone } = repository();
    git(clone, "branch", "-M", "main");
    commit(clone, "first");
    git(clone, "push", "origin", "main");
    git(clone, "switch", "-c", "side");
    const side = commit(clone, "side");
    git(clone, "push", "origin", "side");

    const result = spawnSync("bash", [script, side], {
      cwd: clone,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must point at a commit on main");
  });
});
