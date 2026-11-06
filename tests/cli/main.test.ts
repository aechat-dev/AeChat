import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe("main", () => {
  it("prints usage for --help without opening the store", async () => {
    const stdout: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });

    await expect(main(["--help"])).resolves.toBe(0);
    expect(stdout.join("")).toContain("Usage: aechat");
  });

  it("returns invalid_input for an unknown command without opening the store", async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    await expect(main(["bogus"])).resolves.toBe(6);
    const envelope = JSON.parse(stderr.join("")) as {
      ok: boolean;
      error: { code: string };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.error.code).toBe("invalid_input");
  });
});
