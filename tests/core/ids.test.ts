import { describe, expect, it } from "vitest";

import { newId } from "../../src/core/ids.js";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("returns UUIDv7 strings with the version and variant nibbles set", () => {
    const ids = Array.from({ length: 200 }, () => newId());
    for (const id of ids) {
      expect(id).toMatch(UUID_V7);
    }
  });

  it("returns time-ordered UUIDv7 strings", () => {
    const ids = Array.from({ length: 200 }, () => newId());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });
});
