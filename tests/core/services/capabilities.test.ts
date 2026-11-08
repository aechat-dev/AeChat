import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CapabilityInput,
  CapabilityService,
} from "../../../src/core/services/capability-service.js";
import { openDatabase } from "../../../src/core/store/db.js";
import { ProbeRepository } from "../../../src/core/store/probes.js";
import { migrate } from "../../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../../src/core/transport/fake.js";
import type {
  SessionRecord,
  TransportBindingRecord,
} from "../../../src/core/types.js";

const databases: Array<{ close(): void }> = [];

function setup(options: { mode?: string } = {}) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const probes = new ProbeRepository(db);
  const transport = new FakeTransportAdapter({ mode: options.mode ?? "test" });
  const service = new CapabilityService({
    sessions,
    bindings,
    probes,
    transport,
  });

  const session = sessions.create({
    sessionId: "session-1",
    displayName: "dev",
    client: "claude-code",
    project: "/tmp/project",
    lastSeenAt: "2026-11-07T00:00:00.000Z",
    createdAt: "2026-11-07T00:00:00.000Z",
  });
  const binding = bindings.create({
    bindingId: "binding-1",
    sessionId: "session-1",
    transport: "fake",
    address: "aechat-aaaaaaaaaaaa",
    mode: options.mode ?? "test",
    state: "bound",
  });

  return { service, probes, transport, session, binding };
}

function input(
  session: SessionRecord,
  binding: TransportBindingRecord | null,
  overrides: Partial<CapabilityInput> = {},
): CapabilityInput {
  return {
    session,
    binding,
    status: "online",
    boundState: "valid",
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("CapabilityService.report", () => {
  it("separates supported from available and leaves unprobed wakeup unknown", () => {
    const { service, session, binding } = setup();

    const report = service.report(input(session, binding));
    expect(report.supported).toEqual({
      pull: true,
      wait: true,
      notification_receive: true,
      busy_receive: false,
      idle_wakeup: false,
    });
    expect(report.available).toEqual({
      pull: true,
      wait: true,
      notification_receive: true,
      busy_receive: false,
      idle_wakeup: false,
    });
    expect(report.wakeup_level).toBe("unknown");
    expect(report.observed_at).toBeNull();
  });

  it("makes pull/wait unavailable when offline but keeps supported", () => {
    const { service, session, binding } = setup();

    const report = service.report(
      input(session, binding, { status: "offline", boundState: "invalid" }),
    );
    expect(report.supported.pull).toBe(true);
    expect(report.supported.wait).toBe(true);
    expect(report.available).toEqual({
      pull: false,
      wait: false,
      notification_receive: false,
      busy_receive: false,
      idle_wakeup: false,
    });
  });

  it("keeps pull/wait available when notification mode is off", () => {
    const { service, session, binding } = setup({ mode: "off" });

    const report = service.report(input(session, binding));
    expect(report.available.pull).toBe(true);
    expect(report.available.wait).toBe(true);
    expect(report.available.notification_receive).toBe(false);
  });

  it("only reports busy/idle and level from probe evidence", async () => {
    const { service, session, binding, probes, transport } = setup();
    vi.spyOn(transport, "probe").mockResolvedValue({
      observedLevel: "L3",
      pull: true,
      wait: true,
      notificationReceive: true,
      busyReceive: true,
      idleWakeup: true,
      evidence: { clientVersion: "1.2.3" },
      at: "2026-11-07T00:00:00.000Z",
    });

    const probe = await service.probe("session-1");
    expect(probes.latestForSession("session-1")?.probeId).toBe(probe.probeId);

    const report = service.reportForSession(
      session,
      binding,
      "online",
      "valid",
    );
    expect(report.supported.busy_receive).toBe(true);
    expect(report.supported.idle_wakeup).toBe(true);
    expect(report.available.busy_receive).toBe(true);
    expect(report.available.idle_wakeup).toBe(true);
    expect(report.wakeup_level).toBe("L3");
    expect(report.client_version).toBe("1.2.3");
    expect(report.observed_at).toBe("2026-11-07T00:00:00.000Z");
  });
});
