import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../../src/cli/commands/context.js";
import { watchCommand, watchOnce } from "../../src/cli/commands/watch.js";
import type { InboxItem } from "../../src/core/services/delivery-service.js";

function item(messageId: string): InboxItem {
  return {
    message: {
      messageId,
      kind: "notify",
      fromSession: "peer",
      toSession: "self",
      requestId: null,
      replyTo: null,
      body: `body-${messageId}`,
      dedupKey: null,
      createdAt: "2026-11-09T00:00:00.000Z",
      expiresAt: null,
    },
    delivery: {
      deliveryId: `delivery-${messageId}`,
      messageId,
      sessionId: "self",
      status: "notified",
      deliveryToken: null,
      leaseExpiresAt: null,
      attempts: 0,
      notifiedAt: "2026-11-09T00:00:00.000Z",
      deliveredAt: null,
      ackedAt: null,
      repliedAt: null,
      lastError: null,
      directAttempted: false,
    },
    deliveryToken: null,
  };
}

describe("aechat watch", () => {
  it("peeks without claiming and emits each message once", async () => {
    const inbox = vi.fn(async () => [item("m1"), item("m2")]);
    const ctx = { delivery: { inbox } } as unknown as CommandContext;
    const seen = new Set<string>();

    const first = await watchOnce(ctx, "self", 20, seen);
    const second = await watchOnce(ctx, "self", 20, seen);

    expect(first.map((entry) => entry.message.messageId)).toEqual(["m1", "m2"]);
    expect(second).toEqual([]);
    expect(inbox).toHaveBeenCalledWith({
      sessionId: "self",
      limit: 20,
      peek: true,
    });
  });

  it("uses the full peek window by default", async () => {
    const inbox = vi.fn(async () => []);
    const ctx = { delivery: { inbox } } as unknown as CommandContext;

    await watchCommand(["--session", "self", "--once"], ctx);

    expect(inbox).toHaveBeenCalledWith({
      sessionId: "self",
      limit: 100,
      peek: true,
    });
  });

  it("rejects a limit outside the peek window", async () => {
    const inbox = vi.fn(async () => []);
    const ctx = { delivery: { inbox } } as unknown as CommandContext;

    await expect(
      watchCommand(["--session", "self", "--once", "--limit", "101"], ctx),
    ).rejects.toThrow("--limit must be an integer in 1..100");
    await expect(
      watchCommand(["--session", "self", "--once", "--limit", "0"], ctx),
    ).rejects.toThrow("--limit must be an integer in 1..100");
  });

  it("emits JSONL once and returns the emitted count", async () => {
    const inbox = vi.fn(async () => [item("m1")]);
    const ctx = { delivery: { inbox } } as unknown as CommandContext;
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(String(chunk));
        return true;
      });

    try {
      const result = await watchCommand(["--session", "self", "--once"], ctx);
      expect(result.data).toEqual({ watched: true, emitted: 1 });
    } finally {
      spy.mockRestore();
    }
    expect(writes.join("")).toContain('"event":"aechat_message"');
  });
});
