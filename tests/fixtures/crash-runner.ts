import { DeliveryService } from "../../src/core/services/delivery-service.js";
import { RequestService } from "../../src/core/services/request-service.js";
import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../../src/core/store/messages.js";
import { RequestRepository } from "../../src/core/store/requests.js";
import { migrate } from "../../src/core/store/schema.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../../src/core/store/sessions.js";
import { FakeTransportAdapter } from "../../src/core/transport/fake.js";

const [scenario, dbPath] = process.argv.slice(2);
if (scenario === undefined || dbPath === undefined) {
  throw new Error("usage: crash-runner <scenario> <db-path>");
}

const db = openDatabase(dbPath);
migrate(db);
const sessions = new SessionRepository(db);
const bindings = new TransportBindingRepository(db);
const messages = new MessageRepository(db);
const deliveries = new DeliveryRepository(db);
const requests = new RequestRepository(db);
const realEvents = new EventRepository(db);

for (const [id, name] of [
  ["from", "from"],
  ["to", "to"],
] as const) {
  sessions.create({
    sessionId: id,
    displayName: name,
    client: "claude-code",
    project: `/tmp/${name}`,
    lastSeenAt: "2026-11-08T00:00:00.000Z",
    createdAt: "2026-11-08T00:00:00.000Z",
  });
  bindings.create({
    bindingId: `binding-${id}`,
    sessionId: id,
    transport: "fake",
    address: `aechat-${id}`,
    state: "bound",
  });
}

let killOn: string | null = null;
const events = {
  record: (input: { event: string }) => {
    if (input.event === killOn) {
      process.kill(process.pid, "SIGKILL");
    }
    return realEvents.record(input as Parameters<EventRepository["record"]>[0]);
  },
  listForMessage: (...args: Parameters<EventRepository["listForMessage"]>) =>
    realEvents.listForMessage(...args),
  listForSession: (...args: Parameters<EventRepository["listForSession"]>) =>
    realEvents.listForSession(...args),
} as unknown as EventRepository;

const transport = new FakeTransportAdapter();
if (scenario === "send_after_commit_before_notify") {
  transport.notify = async () => {
    process.kill(process.pid, "SIGKILL");
    return { ok: true };
  };
}

let nextId = 0;
const newId = () => `id-${++nextId}`;
const now = () => "2026-11-08T00:00:00.000Z";

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
  newId,
});
const request = new RequestService({
  db,
  messages,
  deliveries,
  requests,
  delivery,
  events,
  now,
  newId,
});

async function send(kind: "notify" | "request") {
  return delivery.send({
    fromSession: "from",
    toSession: "to",
    kind,
    body: "crash fixture",
    ...(kind === "request" ? { deadlineSeconds: 300 } : {}),
  });
}

switch (scenario) {
  case "send_commit_crash":
    killOn = "send";
    await send("notify");
    break;
  case "send_after_commit_before_notify":
    await send("notify");
    break;
  case "inbox_claim_crash":
    await send("notify");
    killOn = "inbox_claim";
    await delivery.inbox({ sessionId: "to", limit: 1 });
    break;
  case "inbox_after_commit":
    await send("notify");
    await delivery.inbox({ sessionId: "to", limit: 1 });
    process.kill(process.pid, "SIGKILL");
    break;
  case "ack_after_commit": {
    await send("notify");
    const [item] = await delivery.inbox({ sessionId: "to", limit: 1 });
    delivery.ack({
      sessionId: "to",
      token: item?.deliveryToken as string,
    });
    process.kill(process.pid, "SIGKILL");
    break;
  }
  case "reply_after_commit": {
    const sent = await send("request");
    const [item] = await delivery.inbox({ sessionId: "to", limit: 1 });
    delivery.ack({
      sessionId: "to",
      token: item?.deliveryToken as string,
    });
    await request.reply({
      sessionId: "to",
      requestId: sent.messageId,
      body: "crash reply",
    });
    process.kill(process.pid, "SIGKILL");
    break;
  }
  default:
    throw new Error(`unknown scenario: ${scenario}`);
}
