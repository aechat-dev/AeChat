import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("CLI entry point", () => {
  it("runs --help through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-entry-"));
    const link = join(dir, "aechat");
    symlinkSync(join(ROOT, "src", "cli", "main.ts"), link);

    const output = execFileSync("pnpm", ["-s", "exec", "tsx", link, "--help"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(output).toContain("Usage: aechat");
  });
});
