import { homedir } from "node:os";
import { join } from "node:path";

import { AgmsgAdapter } from "../adapters/transport/agmsg/agmsg-adapter.js";
import { AgmsgCli } from "../adapters/transport/agmsg/agmsg-cli.js";
import type { TransportAdapter } from "../core/transport/adapter.js";
import { nowIso } from "../core/time.js";

/** Options shared by the writable and read-only composition roots. */
export interface AppOptions {
  home?: string;
  dbPath?: string;
  team?: string;
  transport?: TransportAdapter;
  now?: () => string;
}

export interface ResolvedPaths {
  home: string;
  dbPath: string;
}

export function resolvePaths(options: AppOptions = {}): ResolvedPaths {
  const home = options.home ?? process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
  return {
    home,
    dbPath: options.dbPath ?? process.env["AECHAT_DB"] ?? join(home, "aechat.db"),
  };
}

export function resolveNow(options: AppOptions = {}): () => string {
  return options.now ?? nowIso;
}

export function resolveTransport(
  options: AppOptions = {},
): { transport: TransportAdapter; agmsgVersion?: () => Promise<string> } {
  if (options.transport !== undefined) {
    return { transport: options.transport };
  }
  const cli = new AgmsgCli();
  return {
    transport: new AgmsgAdapter({
      cli,
      team: options.team ?? process.env["AECHAT_TEAM"] ?? "aechat",
    }),
    agmsgVersion: () => cli.version(),
  };
}
