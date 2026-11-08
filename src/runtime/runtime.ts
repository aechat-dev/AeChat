import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { DatabaseSync } from "node:sqlite";

import { AuditService } from "../core/services/audit-service.js";
import { CapabilityService } from "../core/services/capability-service.js";
import { DeliveryService } from "../core/services/delivery-service.js";
import { RequestService } from "../core/services/request-service.js";
import { ResumeService } from "../core/services/resume-service.js";
import { SessionService } from "../core/services/session-service.js";
import { openDatabase } from "../core/store/db.js";
import { migrate } from "../core/store/schema.js";
import type { TransportAdapter } from "../core/transport/adapter.js";
import {
  type AppOptions,
  resolveNow,
  resolvePaths,
  resolveTransport,
} from "./options.js";
import { type AppRepositories, createRepositories } from "./repositories.js";
import { SessionQueryService } from "./session-query.js";

/** Services that operate on an explicit session; the CLI context is this set. */
export interface AppServices {
  service: SessionService;
  delivery: DeliveryService;
  request: RequestService;
  resume: ResumeService;
  capabilities: CapabilityService;
  audit: AuditService;
  transport: TransportAdapter;
  now: () => string;
  agmsgVersion?: () => Promise<string>;
}

export interface AppRuntime extends AppServices, AppRepositories {
  db: DatabaseSync;
  sessionQuery: SessionQueryService;
  close(): void;
}

/**
 * The writable composition root. CLI commands use this; read-only app
 * surfaces must use `createReadOnlyRuntime`.
 */
export function createRuntime(options: AppOptions = {}): AppRuntime {
  const { home, dbPath } = resolvePaths(options);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(home, "logs"), { recursive: true, mode: 0o700 });
  const db = openDatabase(dbPath);
  migrate(db);

  const repos = createRepositories(db);
  const { transport, agmsgVersion } = resolveTransport(options);
  const now = resolveNow(options);

  const service = new SessionService({
    sessions: repos.sessions,
    bindings: repos.bindings,
    transport,
    requests: repos.requests,
    db,
    events: repos.events,
    now,
  });
  const delivery = new DeliveryService({
    db,
    messages: repos.messages,
    deliveries: repos.deliveries,
    requests: repos.requests,
    sessions: repos.sessions,
    bindings: repos.bindings,
    transport,
    events: repos.events,
    now,
  });
  const request = new RequestService({
    db,
    messages: repos.messages,
    deliveries: repos.deliveries,
    requests: repos.requests,
    delivery,
    events: repos.events,
    now,
  });
  const capabilities = new CapabilityService({
    sessions: repos.sessions,
    bindings: repos.bindings,
    probes: repos.probes,
    transport,
  });
  const resume = new ResumeService({
    db,
    sessions: repos.sessions,
    bindings: repos.bindings,
    deliveries: repos.deliveries,
    transport,
    events: repos.events,
    now,
  });
  const audit = new AuditService({
    messages: repos.messages,
    deliveries: repos.deliveries,
    requests: repos.requests,
    sessions: repos.sessions,
    events: repos.events,
    now,
  });
  const sessionQuery = new SessionQueryService({
    sessions: repos.sessions,
    bindings: repos.bindings,
    transport,
    capabilities,
    now,
  });

  return {
    db,
    ...repos,
    service,
    delivery,
    request,
    resume,
    capabilities,
    audit,
    transport,
    now,
    sessionQuery,
    ...(agmsgVersion === undefined ? {} : { agmsgVersion }),
    close: () => db.close(),
  };
}
