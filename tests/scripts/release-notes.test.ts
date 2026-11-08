import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/release-notes.sh", import.meta.url),
);
const roots: string[] = [];

function changelog(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-release-notes-"));
  roots.push(root);
  const path = join(root, "CHANGELOG.md");
  writeFileSync(path, content);
  return path;
}

function run(tag: string, path: string) {
  return spawnSync("bash", [script, tag, path], { encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release notes", () => {
  it("extracts only the tagged changelog section", () => {
    const path = changelog(`# Changelog

## [Unreleased]

- next

## [0.1.0-alpha.1] - 2026-11-08

### Added

- first alpha

## [0.1.0] - 2026-12-01

- later
`);

    const result = run("v0.1.0-alpha.1", path);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("### Added");
    expect(result.stdout).toContain("- first alpha");
    expect(result.stdout).not.toContain("next");
    expect(result.stdout).not.toContain("later");
  });

  it("fails when the changelog has no section for the tag", () => {
    const path = changelog("# Changelog\n\n## [Unreleased]\n\n- next\n");

    const result = run("v0.1.0-alpha.1", path);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no changelog section");
  });
});
