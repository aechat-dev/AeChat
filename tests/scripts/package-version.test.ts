import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/verify-package-version.sh", import.meta.url),
);
const roots: string[] = [];

function project(version: string): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-package-version-"));
  roots.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "aechat", version }),
  );
  return root;
}

function run(cwd: string, tag: string) {
  return spawnSync("bash", [script, tag], { cwd, encoding: "utf8" });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release package version", () => {
  it("accepts a matching tag", () => {
    const result = run(project("0.1.0-alpha.1"), "v0.1.0-alpha.1");

    expect(result.status).toBe(0);
  });

  it("rejects a tag that does not match package.json", () => {
    const result = run(project("0.1.0-alpha.1"), "v0.2.0");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match");
  });
});
