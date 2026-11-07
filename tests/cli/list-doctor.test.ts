import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandContext } from "../../src/cli/commands/context.js";
import { doctorCommand } from "../../src/cli/commands/doctor.js";
import { listCommand } from "../../src/cli/commands/list.js";
import { CapabilityService } from "../../src/core/services/capability-service.js";
import { DeliveryService } from "../../src/core/services/delivery-service.js";
import { AuditService } from "../../src/core/services/audit-service.js";
import { RequestService } from "../../src/core/services/request-service.js";
import { ResumeService } from "../../src/core/services/resume-service.js";
import { SessionService } from "../../src/core/services/session-service.js";
import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../src/core/store/messages.js";
import { ProbeRepository } from "../../src/core/store/probes.js";
import { RequestRepository } from "../../src/core/store/requests.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../src/core/store/sessions.js";
import { migrate } from "../../src/core/store/schema.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";
import type {
  TransportBinding,
  TransportStatus,
} from "../../src/core/transport/adapter.js";

const databases: Array<{ close(): void }> = [];
const tempDirs: string[] = [];

function setup(options: { mode?: string; live?: boolean } = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const messages = new MessageRepository(db);
  const deliveries = new DeliveryRepository(db);
  const requests = new RequestRepository(db);
  const events = new EventRepository(db);
  const transport = new FakeTransportAdapter({
    mode: options.mode ?? "test",
    live: options.live ?? false,
  });
  const now = () => "2026-11-07T00:00:00.000Z";
  const service = new SessionService({ sessions, bindings, transport, now });
  const delivery = new DeliveryService({
    db,
    messages,
    deliveries,
    requests,
    sessions,
    bindings,
    transport,
    events,
    now,
  });
  const request = new RequestService({
    db,
    messages,
    deliveries,
    requests,
    delivery,
    events,
    now,
  });
  const probes = new ProbeRepository(db);
  const capabilities = new CapabilityService({
    sessions,
    bindings,
    probes,
    transport,
  });
  const resume = new ResumeService({
    db,
    sessions,
    bindings,
    deliveries,
    transport,
    events,
    now,
  });
  const audit = new AuditService({
    messages,
    deliveries,
    requests,
    sessions,
    events,
    now,
  });
  const ctx: CommandContext = {
    service,
    delivery,
    request,
    resume,
    capabilities,
    audit,
    transport,
    now,
  };
  return { db, ctx, sessions, bindings, service, transport, probes };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("list output", () => {
  it("includes status evidence, binding state, transports and capabilities", async () => {
    const { ctx, sessions, bindings } = setup({ mode: "off", live: true });
    sessions.create({
      sessionId: "list-session",
      displayName: "list",
      client: "claude-code",
      project: "/tmp/list",
      boundScope: "host_role",
      boundCheckedAt: "2026-11-07T00:00:00.000Z",
      lastSeenAt: "2026-11-07T00:00:00.000Z",
      hostSeenAt: "2026-11-07T00:00:00.000Z",
      hostSeenSource: "heartbeat",
      createdAt: "2026-11-07T00:00:00.000Z",
    });
    bindings.create({
      bindingId: "list-binding",
      sessionId: "list-session",
      transport: "fake",
      address: "aechat-list",
      mode: "off",
      state: "bound",
    });

    const data = await listCommand(["--json"], ctx);
    const entry = (data["sessions"] as Array<Record<string, unknown>>)[0];
    expect(entry).toMatchObject({
      session_id: "list-session",
      status: "online",
      status_evidence: "transport_live",
      bound_scope: "host_role",
      bound_state: "valid",
    });
    expect(entry?.["transports"]).toEqual([
      expect.objectContaining({ transport: "fake", address: "aechat-list" }),
    ]);
    expect(entry?.["capabilities"]).toMatchObject({
      supported: { pull: true, wait: true, notification_receive: true },
      available: {
        pull: true,
        wait: true,
        notification_receive: false,
        busy_receive: false,
        idle_wakeup: false,
      },
      wakeup_level: "unknown",
    });
  });
});

describe("doctor output", () => {
  it("reports node, agmsg, database, logs, transport and hook facts", async () => {
    const home = mkdtempSync(join(tmpdir(), "aechat-doctor-"));
    tempDirs.push(home);
    const previousHome = process.env["AECHAT_HOME"];
    process.env["AECHAT_HOME"] = home;
    mkdirSync(join(home, "logs"));
    const { ctx, service } = setup();
    await service.register({
      displayName: "doctor",
      client: "claude-code",
      project: "/tmp/doctor",
    });
    const ctxWithVersion: CommandContext = {
      ...ctx,
      agmsgVersion: async () => "1.7.1",
    };

    try {
      const data = await doctorCommand([], ctxWithVersion);
      expect(data).toMatchObject({
        node: { version: process.version },
        agmsg: { checked: true, version: "1.7.1", supported: true },
        database: { path: join(home, "aechat.db"), writable: true },
        logs: { path: join(home, "logs"), exists: true, writable: true },
        transport: { name: "fake" },
        host_hook: { configured: expect.any(Array) },
      });
      expect((data["transport"] as { bindings: unknown[] }).bindings).toHaveLength(1);
    } finally {
      if (previousHome === undefined) {
        delete process.env["AECHAT_HOME"];
      } else {
        process.env["AECHAT_HOME"] = previousHome;
      }
    }
  });
});

describe("capability matrix", () => {
  it("distinguishes running, idle, offline and delivery-off sessions", async () => {
    const { ctx, sessions, bindings, transport, probes } = setup();
    const now = "2026-11-07T00:00:00.000Z";
    for (const [sessionId, mode] of [
      ["running", "monitor"],
      ["idle", "monitor"],
      ["offline", "monitor"],
      ["off", "off"],
    ] as const) {
      sessions.create({
        sessionId,
        displayName: sessionId,
        client: "claude-code",
        project: `/tmp/${sessionId}`,
        boundScope: "host_role",
        boundCheckedAt: now,
        lastSeenAt: sessionId === "offline" ? "2026-11-06T00:00:00.000Z" : now,
        createdAt: now,
      });
      bindings.create({
        bindingId: `binding-${sessionId}`,
        sessionId,
        transport: "fake",
        address: `aechat-${sessionId}`,
        mode,
        state: "bound",
      });
    }
    probes.insert({
      sessionId: "idle",
      client: "claude-code",
      observedLevel: "L3",
      busyReceive: true,
      idleWakeup: true,
      observedAt: now,
    });
    vi.spyOn(transport, "inspect").mockImplementation(
      async (binding?: TransportBinding): Promise<TransportStatus> => ({
        state: binding?.address === "aechat-offline" ? "dead" : "live",
        at: now,
        evidence: {},
      }),
    );

    const data = await listCommand(["--json"], ctx);
    const entries = data["sessions"] as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(entries.map((entry) => [entry["session_id"], entry]));

    expect(byId["running"]?.["status"]).toBe("online");
    expect(byId["running"]?.["capabilities"]).toMatchObject({
      available: { notification_receive: true, idle_wakeup: false },
    });
    expect(byId["idle"]?.["capabilities"]).toMatchObject({
      wakeup_level: "L3",
      available: { notification_receive: true, busy_receive: true, idle_wakeup: true },
    });
    expect(byId["offline"]?.["status"]).toBe("offline");
    expect(byId["offline"]?.["capabilities"]).toMatchObject({
      available: {
        pull: false,
        wait: false,
        notification_receive: false,
        busy_receive: false,
        idle_wakeup: false,
      },
    });
    expect(byId["off"]?.["capabilities"]).toMatchObject({
      available: { pull: true, wait: true, notification_receive: false },
    });
  });
});

describe("bound state and transport evidence", () => {
  it("does not report a valid binding when inspect says dead", async () => {
    const { ctx, sessions, bindings } = setup({ live: false });
    const now = "2026-11-07T00:00:00.000Z";
    sessions.create({
      sessionId: "dead-binding",
      displayName: "dead-binding",
      client: "claude-code",
      project: "/tmp/dead-binding",
      boundScope: "host_role",
      boundCheckedAt: now,
      lastSeenAt: now,
      hostSeenAt: now,
      hostSeenSource: "heartbeat",
      createdAt: now,
    });
    bindings.create({
      bindingId: "dead-binding-row",
      sessionId: "dead-binding",
      transport: "fake",
      address: "aechat-dead-binding",
      mode: "monitor",
      state: "bound",
    });

    const data = await listCommand(["--json"], ctx);
    const entry = (data["sessions"] as Array<Record<string, unknown>>)[0];
    expect(entry).toMatchObject({
      status: "online",
      status_evidence: "heartbeat",
      bound_state: "invalid",
      transports: [expect.objectContaining({ state: "dead" })],
      capabilities: {
        available: {
          pull: false,
          wait: false,
          notification_receive: false,
          busy_receive: false,
          idle_wakeup: false,
        },
      },
    });
  });
});
