import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";
import {
  createReadOnlyRuntime,
  type ReadOnlyRuntime,
} from "../../src/runtime/read-only-runtime.js";
import { createRuntime } from "../../src/runtime/runtime.js";
import { uiEventStream } from "../../src/runtime/ui-event-stream.js";
import { UiQueryService } from "../../src/runtime/ui-query-service.js";

const dirs: string[] = [];
const runtimes: Array<{ close(): void }> = [];

interface Fixture {
  a: string;
  b: string;
  notifyId: string;
  requestId: string;
  replyId: string;
  expiringId: string | null;
  runtime: ReadOnlyRuntime;
  ui: UiQueryService;
}

afterEach(() => {
  while (runtimes.length > 0) {
    runtimes.pop()?.close();
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

const NOW = "2026-11-07T00:00:00.000Z";

async function fixture(
  options: { readNow?: string; expiringRequest?: boolean } = {},
): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), "aechat-ui-query-"));
  dirs.push(home);
  const dbPath = join(home, "aechat.db");
  let writeTick = 0;
  const writeNow = (): string =>
    new Date(Date.parse(NOW) + writeTick++).toISOString();
  const writable = createRuntime({
    home,
    dbPath,
    transport: new FakeTransportAdapter(),
    now: writeNow,
  });
  const a = (
    await writable.service.register({
      displayName: "planner",
      client: "claude-code",
      project: "/tmp/project-a",
    })
  ).session.sessionId;
  const b = (
    await writable.service.register({
      displayName: "worker",
      client: "codex",
      project: "/tmp/project-b",
    })
  ).session.sessionId;

  const notify = await writable.delivery.send({
    fromSession: a,
    toSession: b,
    kind: "notify",
    body: "hello worker",
  });
  const request = await writable.delivery.sendRequest({
    fromSession: a,
    toSession: b,
    body: "please run the tests",
  });
  const reply = await writable.request.reply({
    sessionId: b,
    requestId: request.messageId,
    body: "tests passed",
  });
  let expiringId: string | null = null;
  if (options.expiringRequest === true) {
    expiringId = (
      await writable.delivery.sendRequest({
        fromSession: a,
        toSession: b,
        body: "still open?",
        deadlineSeconds: 1,
      })
    ).messageId;
  }
  writable.close();

  const readNow = options.readNow ?? NOW;
  const runtime = createReadOnlyRuntime({
    home,
    dbPath,
    transport: new FakeTransportAdapter(),
    now: () => readNow,
  });
  runtimes.push(runtime);
  return {
    a,
    b,
    notifyId: notify.messageId,
    requestId: request.messageId,
    replyId: reply.messageId,
    expiringId,
    runtime,
    ui: new UiQueryService(runtime),
  };
}

describe("UiQueryService.snapshot", () => {
  it("returns sessions, one thread and the pending counts", async () => {
    const { a, b, runtime, ui } = await fixture();

    const snapshot = await ui.snapshot();

    expect(
      snapshot.sessions.map((session) => session.session_id).sort(),
    ).toEqual([a, b].sort());
    expect(snapshot.counts.sessions).toBe(2);
    expect(snapshot.event_seq).toBe(runtime.events.latestSeq());
    expect(snapshot.threads).toHaveLength(1);
    const thread = snapshot.threads[0];
    expect(thread?.key).toBe([a, b].sort().join("|"));
    expect(thread?.participants.map((p) => p.display_name).sort()).toEqual([
      "planner",
      "worker",
    ]);
    expect(thread?.last_message.kind).toBe("reply");
    expect(thread?.last_message.preview).toBe("tests passed");
    expect(thread?.pending_requests).toBe(0);
    expect(thread?.pending_deliveries).toBe(2);
  });
});

describe("UiQueryService.messages", () => {
  it("pages newest-first with a stable cursor and pair filter", async () => {
    const { a, b, notifyId, requestId, replyId, ui } = await fixture();

    const page = ui.messages({ sessionId: a, counterpartId: b, limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.next_before).not.toBeNull();
    expect(page.messages[0]?.message_id).toBe(replyId);
    expect(page.messages[1]?.message_id).toBe(requestId);
    expect(page.messages[1]).toMatchObject({
      kind: "request",
      direction: "out",
      request_status: "replied",
      agent_origin: true,
      not_a_user_instruction: true,
    });
    expect(page.messages[0]).toMatchObject({
      kind: "reply",
      reply_to: requestId,
      direction: "in",
    });

    const next = ui.messages({
      sessionId: a,
      counterpartId: b,
      before: page.next_before as string,
      limit: 2,
    });
    expect(next.messages.map((message) => message.message_id)).toEqual([
      notifyId,
    ]);
    expect(next.next_before).toBeNull();
  });

  it("rejects unknown sessions and invalid limits", async () => {
    const { a, ui } = await fixture();
    expect(() => ui.messages({ sessionId: "missing" })).toThrow();
    expect(() => ui.messages({ sessionId: a, counterpartId: a })).toThrow();
    expect(() => ui.messages({ sessionId: a, limit: 0 })).toThrow();
    expect(() => ui.messages({ sessionId: a, limit: 201 })).toThrow();
    expect(() => ui.messages({ sessionId: a, before: "bad" })).toThrow();
  });
});

describe("UiQueryService.events", () => {
  it("carries the correlation fields needed for incremental updates", async () => {
    const { a, b, notifyId, ui } = await fixture();

    const events = ui.events(0);
    const send = events.find((event) => event.event === "send");

    expect(send).toMatchObject({
      kind: "event",
      level: "info",
      session_id: a,
      message_id: notifyId,
      data: { toSession: b, kind: "notify" },
    });
    expect(send?.delivery_id).toEqual(expect.any(String));
    expect(send?.request_id).toBeNull();
    expect(send?.seq).toBeGreaterThan(0);
  });
});

describe("effective request status", () => {
  it("reports an overdue open request as expired without writing", async () => {
    const { a, b, expiringId, runtime, ui } = await fixture({
      expiringRequest: true,
      readNow: new Date(Date.parse(NOW) + 10_000).toISOString(),
    });
    const messageId = expiringId as string;

    const snapshot = await ui.snapshot();
    expect(snapshot.threads[0]?.pending_requests).toBe(0);

    const page = ui.messages({ sessionId: a, counterpartId: b, limit: 50 });
    const request = page.messages.find(
      (message) => message.message_id === messageId,
    );
    expect(request).toMatchObject({
      kind: "request",
      request_status: "expired",
      request_close_reason: "deadline",
    });
    expect(request?.request_deadline).not.toBeNull();

    const log = ui.log({ messageId });
    expect(log.request_status).toBe("expired");
    expect(log.request_close_reason).toBe("deadline");
    expect(log.request_deadline).not.toBeNull();

    // Derivation is read-only: the stored row is still open.
    expect(runtime.requests.get(messageId)).toMatchObject({ status: "open" });
  });
});

describe("read-only guarantee", () => {
  it("snapshot, messages, events and log do not write events or state", async () => {
    const { a, b, notifyId, runtime, ui } = await fixture();
    const eventsBefore = runtime.events.listAfter(0).map((event) => event.seq);
    const deliveryBefore = runtime.deliveries.getByMessageId(notifyId);
    const sessionBefore = runtime.sessions.get(a);

    await ui.snapshot();
    ui.messages({ sessionId: a, counterpartId: b, limit: 50 });
    ui.events(0);
    const entry = ui.log({ messageId: notifyId });

    expect(entry.chain.length).toBeGreaterThan(0);
    expect(runtime.events.listAfter(0).map((event) => event.seq)).toEqual(
      eventsBefore,
    );
    expect(runtime.deliveries.getByMessageId(notifyId)).toEqual(deliveryBefore);
    expect(runtime.sessions.get(a)).toEqual(sessionBefore);
    expect(
      runtime.events.listAfter(0).some((event) => event.event === "log_read"),
    ).toBe(false);
    expect(
      runtime.events.listAfter(0).some((event) => event.event === "list"),
    ).toBe(false);
  });
});

describe("uiEventStream", () => {
  it("emits events after the cursor and a snapshot tick", async () => {
    const { runtime, ui } = await fixture();
    const all = ui.events(0);
    expect(all.length).toBeGreaterThan(2);

    const controller = new AbortController();
    const seen: string[] = [];
    for await (const item of uiEventStream(ui, runtime.now, {
      after: all[0]?.seq as number,
      signal: controller.signal,
      pollMs: 1,
      tickMs: 0,
      limit: 1,
    })) {
      seen.push(item.kind);
      if (item.kind === "snapshot") {
        break;
      }
    }
    controller.abort();

    expect(seen).toContain("event");
    expect(seen).toContain("snapshot");
  });
});
