import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOSTS, hostById, hostConfigDir } from "../adapters/hosts/registry.js";
import { AechatError } from "../core/errors.js";

export interface HostPaths {
  configDir: string;
  skillFile: string;
}

export interface InstallResult {
  host: string;
  path: string;
  action:
    | "installed"
    | "updated"
    | "up-to-date"
    | "would-install"
    | "would-update";
  dry_run: boolean;
}

/**
 * Resolve the skill source shipped next to the CLI. Works from src/ under
 * tsx, from dist/ in the npm package, and from Resources/cli in the app
 * bundle because all three place `skills/` two levels above the runtime dir.
 */
export function skillSourceRoot(): string {
  return fileURLToPath(new URL("../../skills", import.meta.url));
}

export function hostPaths(
  hostId: string,
  env: NodeJS.ProcessEnv = process.env,
): HostPaths {
  const host = hostById(hostId);
  if (host === undefined) {
    throw new AechatError("invalid_input", `unknown host: ${hostId}`);
  }
  const configDir = hostConfigDir(host, env);
  return {
    configDir,
    skillFile: join(configDir, "skills", "aechat", "SKILL.md"),
  };
}

function commandOnPath(
  command: string,
  pathValue: string | undefined,
): boolean {
  if (pathValue === undefined) {
    return false;
  }
  return pathValue
    .split(":")
    .filter((entry) => entry.length > 0)
    .some((entry) => existsSync(join(entry, command)));
}

/** Hosts that look installed: a config directory or the CLI on PATH. */
export function detectHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return HOSTS.filter(
    (host) =>
      existsSync(hostConfigDir(host, env)) ||
      commandOnPath(host.command, env["PATH"]),
  ).map((host) => host.id);
}

/**
 * Install or refresh the AeChat skill for one host. The file is product-owned:
 * an existing different file is replaced so an upgrade cannot leave an old
 * skill in place.
 */
export function installHostSkill(options: {
  host: string;
  sourceRoot?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
}): InstallResult {
  const host = hostById(options.host);
  if (host === undefined) {
    throw new AechatError("invalid_input", `unknown host: ${options.host}`);
  }
  const source = join(
    options.sourceRoot ?? skillSourceRoot(),
    host.id,
    "SKILL.md",
  );
  let content: string;
  try {
    content = readFileSync(source, "utf8");
  } catch {
    throw new AechatError("internal", `bundled skill is missing: ${source}`);
  }

  const target = hostPaths(host.id, options.env).skillFile;
  const exists = existsSync(target);
  const same = exists && readFileSync(target, "utf8") === content;
  const dryRun = options.dryRun === true;
  if (same) {
    return {
      host: host.id,
      path: target,
      action: "up-to-date",
      dry_run: dryRun,
    };
  }

  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: "utf8", mode: 0o644 });
  }
  return {
    host: host.id,
    path: target,
    action: dryRun
      ? exists
        ? "would-update"
        : "would-install"
      : exists
        ? "updated"
        : "installed",
    dry_run: dryRun,
  };
}
