import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [dbPath, fromSession, toSession, dedupKey, startFile, sleepRaw] =
  process.argv.slice(2);
if (
  dbPath === undefined ||
  fromSession === undefined ||
  toSession === undefined ||
  dedupKey === undefined ||
  startFile === undefined
) {
  throw new Error("send-race-worker: missing arguments");
}

const root = process.env["AECHAT_REPO_ROOT"];
if (root === undefined) {
  throw new Error("send-race-worker: AECHAT_REPO_ROOT is required");
}
const load = (relative: string) =>
  import(pathToFileURL(join(root, relative)).href);

const { openDatabase } = await load("src/core/store/db.ts");
const { EventRepository } = await load("src/core/store/events.ts");
const { DeliveryRepository, MessageRepository } = await load(
  "src/core/store/messages.ts",
);
const { migrate } = await load("src/core/store/schema.ts");
const { SessionRepository, TransportBindingRepository } = await load(
  "src/core/store/sessions.ts",
);
const { FakeTransportAdapter } = await load("src/core/transport/fake.ts");
const { DeliveryService } = await load(
  "src/core/services/delivery-service.ts",
);

const db = openDatabase(dbPath);
const sessions = new SessionRepository(db);
const bindings = new TransportBindingRepository(db);
const messages = new MessageRepository(db);
const deliveries = new DeliveryRepository(db);
const events = new EventRepository(db);
const transport = new FakeTransportAdapter();

// Widen the window between the dedup lookup and insertion. The correct
// implementation holds BEGIN IMMEDIATE across both, so the second process
// cannot read an empty result while the first is still inserting.
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const originalLookup = messages.findByDedupKeyFromSender.bind(messages);
messages.findByDedupKeyFromSender = (...args: [string, string]) => {
  const result = originalLookup(...args);
  Atomics.wait(sleeper, 0, 0, Number(sleepRaw ?? "150"));
  return result;
};

while (!existsSync(startFile)) {
  await delay(5);
}

const service = new DeliveryService({
  db,
  messages,
  deliveries,
  sessions,
  bindings,
  transport,
  events,
  now: () => "2026-11-07T00:00:00.000Z",
});

try {
  const result = await service.send({
    fromSession,
    toSession,
    kind: "notify",
    body: "race",
    dedupKey,
  });
  process.stdout.write(
    `${JSON.stringify({ ok: true, messageId: result.messageId })}\n`,
  );
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";
  process.stdout.write(`${JSON.stringify({ ok: false, code })}\n`);
}
db.close();
