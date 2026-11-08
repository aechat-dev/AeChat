import { afterEach, describe, expect, it } from "vitest";
import { cancelCommand } from "../../src/cli/commands/cancel.js";
import type { CommandContext } from "../../src/cli/commands/context.js";
import { replyCommand } from "../../src/cli/commands/reply.js";
import { retryCommand } from "../../src/cli/commands/retry.js";
import { sendCommand } from "../../src/cli/commands/send.js";
import { waitCommand } from "../../src/cli/commands/wait.js";
import type { CommandResult } from "../../src/cli/output.js";
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
import { SessionQueryService } from "../../src/runtime/session-query.js";

const databases: Array<{ close(): void }> = [];

function setup(options: { notifyFails?: boolean } = {}) {
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
    notifyFails: options.notifyFails ?? false,
  });
  const now = () => "2026-11-07T00:00:00.000Z";
  const sessionService = new SessionService({
    sessions,
    bindings,
    transport,
    now,
  });
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
    service: sessionService,
    delivery,
    request,
    resume,
    capabilities,
    audit,
    transport,
    now,
    sessionQuery: new SessionQueryService({
      sessions,
      bindings,
      transport,
      capabilities,
      now,
    }),
  };

  async function addSession(name: string): Promise<string> {
    const result = await sessionService.register({
      displayName: name,
      client: "claude-code",
      project: `/tmp/${name}`,
    });
    return result.session.sessionId;
  }

  return { ctx, delivery, request, addSession, requests };
}

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

function dataOf(result: unknown): Record<string, unknown> {
  return (result as CommandResult).data as Record<string, unknown>;
}

describe("request CLI commands", () => {
  it("send --request writes a request with its deadline", async () => {
    const { ctx, addSession, requests } = setup();
    const requester = await addSession("requester");
    const target = await addSession("target");

    const sent = await sendCommand(
      [
        "--session",
        requester,
        "--to-session",
        target,
        "--request",
        "--deadline",
        "60",
        "--body",
        "please reply",
      ],
      ctx,
    );
    const requestId = sent["message_id"] as string;
    expect(requests.get(requestId)).toMatchObject({
      status: "open",
      requesterSession: requester,
      targetSession: target,
      deadline: "2026-11-07T00:01:00.000Z",
    });
  });

  it("reply and wait --request expose the linked reply", async () => {
    const { ctx, delivery, addSession } = setup();
    const requester = await addSession("requester");
    const target = await addSession("target");
    const request = await delivery.sendRequest({
      fromSession: requester,
      toSession: target,
      body: "please reply",
    });

    const replied = (await replyCommand(
      ["--session", target, "--request", request.messageId, "--body", "answer"],
      ctx,
    )) as Record<string, unknown>;
    expect(replied["request_id"]).toBe(request.messageId);
    expect(replied["already_replied"]).toBe(false);

    const waited = dataOf(
      await waitCommand(
        [
          "--session",
          requester,
          "--request",
          request.messageId,
          "--timeout",
          "1",
          "--json",
        ],
        ctx,
      ),
    );
    expect(waited["status"]).toBe("replied");
    expect(waited["message"]).toMatchObject({
      message_id: replied["message_id"],
      kind: "reply",
      request_id: request.messageId,
    });
  });

  it("wait --request returns timeout with exit code 2", async () => {
    const { ctx, delivery, addSession } = setup();
    const requester = await addSession("requester");
    const target = await addSession("target");
    const request = await delivery.sendRequest({
      fromSession: requester,
      toSession: target,
      body: "please reply",
    });

    const result = (await waitCommand(
      [
        "--session",
        requester,
        "--request",
        request.messageId,
        "--timeout",
        "0.1",
        "--json",
      ],
      ctx,
    )) as CommandResult;
    expect(result.data).toEqual({ status: "timeout" });
    expect(result.exitCode).toBe(2);
  });

  it("cancel by sender wins and blocks reply", async () => {
    const { ctx, delivery, addSession } = setup();
    const requester = await addSession("requester");
    const target = await addSession("target");
    const request = await delivery.sendRequest({
      fromSession: requester,
      toSession: target,
      body: "please reply",
    });

    const cancelled = dataOf(
      await cancelCommand(
        ["--session", requester, "--request", request.messageId],
        ctx,
      ),
    );
    expect(cancelled).toEqual({
      request_id: request.messageId,
      cancelled: true,
    });
    await expect(
      replyCommand(
        ["--session", target, "--request", request.messageId, "--body", "late"],
        ctx,
      ),
    ).rejects.toMatchObject({ code: "request_cancelled" });
  });

  it("retry acts on notify_failed and is scoped to the sender", async () => {
    const { ctx, delivery, addSession } = setup({ notifyFails: true });
    const sender = await addSession("sender");
    const target = await addSession("target");
    const sent = await delivery.send({
      fromSession: sender,
      toSession: target,
      kind: "notify",
      body: "retry me",
    });
    expect(sent.status).toBe("notify_failed");

    const retried = (await retryCommand(
      ["--session", sender, "--message", sent.messageId],
      ctx,
    )) as Record<string, unknown>;
    expect(retried).toMatchObject({
      message_id: sent.messageId,
      retried: true,
      status: "notify_failed",
    });
    await expect(
      retryCommand(["--session", target, "--message", sent.messageId], ctx),
    ).rejects.toMatchObject({ code: "not_actor" });
  });
});
