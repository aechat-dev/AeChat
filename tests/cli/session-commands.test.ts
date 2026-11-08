import { afterEach, describe, expect, it } from "vitest";
import { SessionQueryService } from "../../src/app/session-query.js";
import { listCommand } from "../../src/cli/commands/list.js";
import { registerCommand } from "../../src/cli/commands/register.js";
import { whoamiCommand } from "../../src/cli/commands/whoami.js";
import { AuditService } from "../../src/core/services/audit-service.js";
import { CapabilityService } from "../../src/core/services/capability-service.js";
import { DeliveryService } from "../../src/core/services/delivery-service.js";
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
import { migrate } from "../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";

const databases: Array<{ close(): void }> = [];

function setup(
  options: ConstructorParameters<typeof FakeTransportAdapter>[0] = {},
) {
  const db = openDatabase(":memory:");
  databases.push(db);
  migrate(db);
  const sessions = new SessionRepository(db);
  const bindings = new TransportBindingRepository(db);
  const transport = new FakeTransportAdapter({ live: true, ...options });
  const service = new SessionService({
    sessions,
    bindings,
    transport,
    now: () => "2026-11-06T12:00:00.000Z",
  });
  const delivery = new DeliveryService({
    db,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    sessions,
    bindings,
    transport,
    events: new EventRepository(db),
    now: () => "2026-11-06T12:00:00.000Z",
  });
  const request = new RequestService({
    db,
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    delivery,
    events: new EventRepository(db),
    now: () => "2026-11-06T12:00:00.000Z",
  });
  const capabilities = new CapabilityService({
    sessions,
    bindings,
    probes: new ProbeRepository(db),
    transport,
  });
  const resume = new ResumeService({
    db,
    sessions,
    bindings,
    deliveries: new DeliveryRepository(db),
    transport,
    events: new EventRepository(db),
    now: () => "2026-11-06T12:00:00.000Z",
  });
  const audit = new AuditService({
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    sessions,
    events: new EventRepository(db),
    now: () => "2026-11-06T12:00:00.000Z",
  });
  const sessionQuery = new SessionQueryService({
    sessions,
    bindings,
    transport,
    capabilities,
    now: () => "2026-11-06T12:00:00.000Z",
  });
  return {
    service,
    delivery,
    request,
    resume,
    capabilities,
    audit,
    transport,
    sessionQuery,
  };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("session CLI commands", () => {
  it("register returns a session id and bind directive", async () => {
    const {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
    } = setup();

    const data = await registerCommand(
      ["--name", "dev", "--client", "claude-code", "--project", "/tmp/project"],
      {
        service,
        delivery,
        request,
        resume,
        capabilities,
        audit,
        transport,
        sessionQuery,
        now: () => "2026-11-06T12:00:00.000Z",
      },
    );

    expect(data["session_id"]).toBeTypeOf("string");
    expect(data["bind_directive"]).toContain(data["address"]);
    expect(data["bound_scope"]).toBe("none");
  });

  it("whoami --conversation works without --session", async () => {
    const {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
    } = setup();
    const registered = await service.register({
      displayName: "dev",
      client: "claude-code",
      project: "/tmp/project",
      conversationId: "conv-1",
    });

    const data = whoamiCommand(["--conversation", "conv-1"], {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
      now: () => "2026-11-06T12:00:00.000Z",
    });
    expect(data["session_id"]).toBe(registered.session.sessionId);
  });

  it("list --json includes supported/available separately", async () => {
    const {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
    } = setup();
    const registered = await registerCommand(
      ["--name", "dev", "--client", "claude-code", "--project", "/tmp/project"],
      {
        service,
        delivery,
        request,
        resume,
        capabilities,
        audit,
        transport,
        sessionQuery,
        now: () => "2026-11-06T12:00:00.000Z",
      },
    );
    await service.confirm(registered["session_id"] as string);

    const data = await listCommand(["--json"], {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
      now: () => "2026-11-06T12:00:00.000Z",
    });
    const sessions = data["sessions"] as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(1);
    const caps = sessions[0]?.["capabilities"] as Record<string, unknown>;
    expect(caps["supported"]).toEqual(
      expect.objectContaining({ pull: true, wait: true }),
    );
    expect(caps["available"]).toEqual(
      expect.objectContaining({ pull: true, wait: true }),
    );
    expect(caps["wakeup_level"]).toBe("unknown");
  });

  it("does not mark capabilities available when the delivery mode is unknown", async () => {
    const {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
    } = setup({ mode: "unknown" });
    const registered = await registerCommand(
      ["--name", "dev", "--client", "claude-code", "--project", "/tmp/project"],
      {
        service,
        delivery,
        request,
        resume,
        capabilities,
        audit,
        transport,
        sessionQuery,
        now: () => "2026-11-06T12:00:00.000Z",
      },
    );
    await service.confirm(registered["session_id"] as string);

    const data = await listCommand(["--json"], {
      service,
      delivery,
      request,
      resume,
      capabilities,
      audit,
      transport,
      sessionQuery,
      now: () => "2026-11-06T12:00:00.000Z",
    });
    const sessions = data["sessions"] as Array<Record<string, unknown>>;
    const caps = sessions[0]?.["capabilities"] as Record<string, unknown>;
    expect(caps["available"]).toEqual({
      pull: true,
      wait: true,
      notification_receive: false,
      busy_receive: false,
      idle_wakeup: false,
    });
  });
});
