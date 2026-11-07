import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../src/core/store/db.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe("openDatabase", () => {
  it("keeps the message database owner-only", () => {
    const dir = mkdtempSync(join(tmpdir(), "aechat-db-"));
    dirs.push(dir);
    const path = join(dir, "aechat.db");
    const db = openDatabase(path);
    try {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      db.close();
    }
  });
});
