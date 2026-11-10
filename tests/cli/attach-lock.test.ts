import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withAttachLock } from "../../src/cli/attach-lock.js";

const roots: string[] = [];

function home(): string {
  const root = mkdtempSync(join(tmpdir(), "aechat-lock-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("withAttachLock", () => {
  it("serializes concurrent attaches for one conversation", async () => {
    const dir = home();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withAttachLock(
      "thread-1",
      async () => {
        order.push("first-start");
        await firstHeld;
        order.push("first-end");
      },
      { home: dir },
    );
    const second = withAttachLock(
      "thread-1",
      async () => {
        order.push("second");
      },
      { home: dir },
    );

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(order).toEqual(["first-start"]);
    releaseFirst?.();
    await Promise.all([first, second]);

    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(readdirSync(join(dir, "locks"))).toEqual([]);
  });

  it("breaks a stale lock left by a crashed attach", async () => {
    const dir = home();
    mkdirSync(join(dir, "locks"), { recursive: true });
    const stale = join(dir, "locks", "attach-thread-1.lock");
    writeFileSync(stale, "999\n");
    const old = new Date(Date.now() - 120_000);
    utimesSync(stale, old, old);

    await expect(
      withAttachLock("thread-1", async () => "ran", { home: dir }),
    ).resolves.toBe("ran");
  });

  it("keeps different conversations independent", async () => {
    const dir = home();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withAttachLock(
      "thread-1",
      async () => {
        await firstHeld;
        order.push("thread-1");
      },
      { home: dir },
    );
    await withAttachLock(
      "thread-2",
      async () => {
        order.push("thread-2");
      },
      { home: dir },
    );

    expect(order).toEqual(["thread-2"]);
    releaseFirst?.();
    await first;
  });
});
