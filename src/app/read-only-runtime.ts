import type { DatabaseSync } from "node:sqlite";

import { CapabilityService } from "../core/services/capability-service.js";
import { openReadOnlyDatabase } from "../core/store/db.js";
import { assertCurrentSchema } from "../core/store/schema.js";
import type { TransportAdapter } from "../core/transport/adapter.js";
import { resolveNow, resolvePaths, resolveTransport, type AppOptions } from "./options.js";
import { createRepositories, type AppRepositories } from "./repositories.js";
import { SessionQueryService, type CapabilityQuery } from "./session-query.js";

/**
 * Query-only surface for the app bridge. It deliberately exposes no write
 * service and no `migrate`, `chmod` or WAL configuration path.
 */
export interface ReadOnlyRuntime extends AppRepositories {
  db: DatabaseSync;
  capabilities: CapabilityQuery;
  transport: TransportAdapter;
  now: () => string;
  sessionQuery: SessionQueryService;
  close(): void;
}

/** Open the existing store without any write or permission side effect. */
export function createReadOnlyRuntime(options: AppOptions = {}): ReadOnlyRuntime {
  const { dbPath } = resolvePaths(options);
  const db = openReadOnlyDatabase(dbPath);
  try {
    assertCurrentSchema(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const repos = createRepositories(db);
  const { transport } = resolveTransport(options);
  const now = resolveNow(options);
  const service = new CapabilityService({
    sessions: repos.sessions,
    bindings: repos.bindings,
    probes: repos.probes,
    transport,
  });
  const capabilities: CapabilityQuery = {
    reportForSession: service.reportForSession.bind(service),
  };
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
    capabilities,
    transport,
    now,
    sessionQuery,
    close: () => db.close(),
  };
}
