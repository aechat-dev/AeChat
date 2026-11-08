import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../src/core/store/messages.js";
import { RequestRepository } from "../../src/core/store/requests.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixture = fileURLToPath(
  new URL("../fixtures/crash-runner.ts", import.meta.url),
);
const roots: string[] = [];

function crash(scenario: string): {
  db: ReturnType<typeof openDatabase>;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  requests: RequestRepository;
  events: EventRepository;
} {
  const dir = mkdtempSync(join(tmpdir(), "aechat-crash-"));
  roots.push(dir);
  const dbPath = join(dir, "aechat.db");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", fixture, scenario, dbPath],
    { cwd: root, encoding: "utf8" },
  );
  expect(result.signal).toBe("SIGKILL");
  const db = openDatabase(dbPath);
  return {
    db,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    events: new EventRepository(db),
  };
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("crash recovery", () => {
  it("rolls back a send whose audit event never commits", () => {
    const { db, messages, deliveries, events } = crash("send_commit_crash");
    try {
      expect(messages.get("id-1")).toBeUndefined();
      expect(deliveries.get("id-2")).toBeUndefined();
      expect(events.listForMessage("id-1")).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("keeps a committed message when the process dies before notify", () => {
    const { db, messages, deliveries, events } = crash(
      "send_after_commit_before_notify",
    );
    try {
      expect(messages.get("id-1")?.body).toBe("crash fixture");
      expect(deliveries.get("id-2")?.status).toBe("stored");
      const names = events.listForMessage("id-1").map((event) => event.event);
      expect(names).toContain("send");
      expect(names).not.toContain("notify");
    } finally {
      db.close();
    }
  });

  it("rolls back a claim whose inbox_claim event never commits", () => {
    const { db, deliveries, events } = crash("inbox_claim_crash");
    try {
      const delivery = deliveries.get("id-2");
      expect(delivery?.status).toBe("notified");
      expect(delivery?.deliveryToken).toBeNull();
      expect(delivery?.leaseExpiresAt).toBeNull();
      expect(
        events.listForMessage("id-1").map((event) => event.event),
      ).not.toContain("inbox_claim");
    } finally {
      db.close();
    }
  });

  it("keeps the claim and its lease after a crash", () => {
    const { db, deliveries, events } = crash("inbox_after_commit");
    try {
      const delivery = deliveries.get("id-2");
      expect(delivery?.status).toBe("delivered");
      expect(delivery?.deliveryToken).not.toBeNull();
      expect(delivery?.leaseExpiresAt).not.toBeNull();
      expect(
        events.listForMessage("id-1").map((event) => event.event),
      ).toContain("inbox_claim");
    } finally {
      db.close();
    }
  });

  it("keeps an acknowledgement after a crash", () => {
    const { db, deliveries, events } = crash("ack_after_commit");
    try {
      expect(deliveries.get("id-2")?.status).toBe("acked");
      expect(
        events.listForMessage("id-1").map((event) => event.event),
      ).toContain("ack");
    } finally {
      db.close();
    }
  });

  it("keeps a reply and its request transition after a crash", () => {
    const { db, messages, requests, events } = crash("reply_after_commit");
    try {
      expect(requests.get("id-1")?.status).toBe("replied");
      expect(messages.get("id-3")?.body).toBe("crash reply");
      expect(
        events.listForMessage("id-1").map((event) => event.event),
      ).toContain("reply");
    } finally {
      db.close();
    }
  });
});
