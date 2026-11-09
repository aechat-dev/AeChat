import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(
  new URL("../../scripts/release-checksums.sh", import.meta.url),
);
const roots: string[] = [];

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release checksums", () => {
  it("lists published basenames instead of build paths", () => {
    const root = mkdtempSync(join(tmpdir(), "aechat-checksums-"));
    roots.push(root);
    mkdirSync(join(root, "dist"));
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "aechat-0.1.0.tgz"), "tarball");
    writeFileSync(join(root, "dist", "AeChat.app.zip"), "app");
    writeFileSync(join(root, "scripts", "install.sh"), "installer");

    const result = spawnSync(
      "bash",
      [
        script,
        join(root, "aechat-0.1.0.tgz"),
        join(root, "dist", "AeChat.app.zip"),
        join(root, "scripts", "install.sh"),
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `${sha("tarball")}  aechat-0.1.0.tgz\n` +
        `${sha("app")}  AeChat.app.zip\n` +
        `${sha("installer")}  install.sh\n`,
    );
    expect(result.stdout).not.toContain(root);
  });

  it("fails when an asset is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "aechat-checksums-"));
    roots.push(root);

    const result = spawnSync("bash", [script, join(root, "missing.tgz")], {
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
  });
});
