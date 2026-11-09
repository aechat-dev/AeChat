import { homedir } from "node:os";
import { join } from "node:path";

import { queueCodexMessage } from "../adapters/hosts/codex.js";
import { AgmsgAdapter } from "../adapters/transport/agmsg/agmsg-adapter.js";
import { AgmsgCli } from "../adapters/transport/agmsg/agmsg-cli.js";
import { nowIso } from "../core/time.js";
import type { TransportAdapter } from "../core/transport/adapter.js";

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
  const home =
    options.home ?? process.env["AECHAT_HOME"] ?? join(homedir(), ".aechat");
  return {
    home,
    dbPath:
      options.dbPath ?? process.env["AECHAT_DB"] ?? join(home, "aechat.db"),
  };
}

export function resolveNow(options: AppOptions = {}): () => string {
  return options.now ?? nowIso;
}

export function resolveTransport(options: AppOptions = {}): {
  transport: TransportAdapter;
  agmsgVersion?: () => Promise<string>;
} {
  if (options.transport !== undefined) {
    return { transport: options.transport };
  }
  const cli = new AgmsgCli();
  return {
    transport: new AgmsgAdapter({
      cli,
      team: options.team ?? process.env["AECHAT_TEAM"] ?? "aechat",
      directDelivery: async (input) => {
        const queued = await queueCodexMessage({
          thread: input.conversationId,
          body: input.body,
        });
        return queued.ok
          ? { ok: true }
          : {
              ok: false,
              ...(queued.error === undefined ? {} : { error: queued.error }),
            };
      },
    }),
    agmsgVersion: () => cli.version(),
  };
}
