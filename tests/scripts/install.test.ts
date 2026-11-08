import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/install.sh", import.meta.url),
);

function run(...args: string[]) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8" });
}

describe("install script", () => {
  it("prints a deterministic plan for an explicit version", () => {
    const result = run("--version", "0.1.0-alpha.1", "--dry-run");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tag: v0.1.0-alpha.1");
    expect(result.stdout).toContain("aechat-0.1.0-alpha.1.tgz");
    expect(result.stdout).toContain("SHA256SUMS");
    expect(result.stdout).toContain("npm install -g");
  });

  it("honors a custom prefix in the plan", () => {
    const result = run(
      "--version",
      "v0.1.0-alpha.1",
      "--prefix",
      "/tmp/aechat-prefix",
      "--dry-run",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "npm install -g --prefix /tmp/aechat-prefix",
    );
  });

  it("rejects an unknown option", () => {
    const result = run("--bogus");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown option");
  });

  it("documents its options in help", () => {
    const result = run("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--version <tag>");
    expect(result.stdout).toContain("--stable");
    expect(result.stdout).toContain("--dry-run");
  });
});
