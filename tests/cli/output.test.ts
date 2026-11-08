import { afterEach, describe, expect, it, vi } from "vitest";

import { fail, ok } from "../../src/cli/output.js";
import { AechatError, exitCodeFor } from "../../src/core/errors.js";

function capture(stream: NodeJS.WriteStream): string[] {
  const chunks: string[] = [];
  vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"),
    );
    return true;
  });
  return chunks;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe("output envelope", () => {
  it("ok emits { ok: true, data, meta.schema: 1 }", () => {
    const stdout = capture(process.stdout);

    ok({ hello: "world" });

    const envelope = JSON.parse(stdout.join("")) as unknown;
    expect(envelope).toEqual({
      ok: true,
      data: { hello: "world" },
      meta: { schema: 1 },
    });
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("fail emits { ok: false, error: { code, message } } and exit code 5 for not_actor", () => {
    const stderr = capture(process.stderr);

    expect(() => fail("not_actor", "only the sender may do this")).toThrow(
      AechatError,
    );

    const envelope = JSON.parse(stderr.join("")) as {
      ok: boolean;
      error: { code: string; message: string };
      meta: { schema: number };
    };
    expect(envelope).toEqual({
      ok: false,
      error: { code: "not_actor", message: "only the sender may do this" },
      meta: { schema: 1 },
    });
    expect(process.exitCode).toBe(5);
    expect(exitCodeFor("not_actor")).toBe(5);
  });

  it("fail includes details only when provided", () => {
    const stderr = capture(process.stderr);

    expect(() => fail("invalid_input", "bad", { field: "name" })).toThrow(
      AechatError,
    );
    const withDetails = JSON.parse(stderr.join("")) as {
      error: Record<string, unknown>;
    };
    expect(withDetails.error["details"]).toEqual({ field: "name" });

    stderr.length = 0;
    expect(() => fail("invalid_input", "bad")).toThrow(AechatError);
    const withoutDetails = JSON.parse(stderr.join("")) as {
      error: Record<string, unknown>;
    };
    expect("details" in withoutDetails.error).toBe(false);
  });
});
