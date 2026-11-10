import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Host declarations live in the adapter layer. Core and the CLI consume this
 * registry; adding a host must not require a new branch in either.
 */
export interface HostDescriptor {
  id: string;
  label: string;
  command: string;
  sessionEnv: string;
  configEnv: string;
  configDirName: string;
  /** Settings/hook file inside the host config directory. */
  hookFile: string;
  /** Extra guidance when a host-session claim is not confirmed. */
  bindingHint?: string;
}

export const SHARED_SESSION_ENV = "AGMSG_SESSION_ID";

export const HOSTS: readonly HostDescriptor[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    command: "claude",
    sessionEnv: "CLAUDE_CODE_SESSION_ID",
    configEnv: "CLAUDE_CONFIG_DIR",
    configDirName: ".claude",
    hookFile: "settings.json",
  },
  {
    id: "codex",
    label: "Codex",
    command: "codex",
    sessionEnv: "CODEX_THREAD_ID",
    configEnv: "CODEX_HOME",
    configDirName: ".codex",
    hookFile: "config.toml",
    bindingHint:
      "Codex needs the agmsg bridge for a live role: run `aechat setup codex --hooks`, then launch Codex through the agmsg shim. Without it the session stays pull-only.",
  },
];

export function hostById(id: string): HostDescriptor | undefined {
  return HOSTS.find((host) => host.id === id);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

export function hostConfigDir(
  host: HostDescriptor,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return nonEmpty(env[host.configEnv]) ?? join(homedir(), host.configDirName);
}

/** Where each host keeps its hook/settings file, resolved per environment. */
export function hostHookPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  return HOSTS.map((host) => join(hostConfigDir(host, env), host.hookFile));
}

/** The hook/settings file for one host, resolved per environment. */
export function hostHookPath(
  hostId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const host = hostById(hostId);
  return host === undefined
    ? undefined
    : join(hostConfigDir(host, env), host.hookFile);
}

/** The host session id used for actas claims; the shared override wins. */
export function hostSessionId(
  host: HostDescriptor,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return nonEmpty(env[SHARED_SESSION_ENV]) ?? nonEmpty(env[host.sessionEnv]);
}
