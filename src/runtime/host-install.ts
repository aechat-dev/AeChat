import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AechatError } from "../core/errors.js";

export type HostId = "claude-code" | "codex";

export interface HostPaths {
  configDir: string;
  skillFile: string;
}

export interface InstallResult {
  host: HostId;
  path: string;
  action: "installed" | "updated" | "up-to-date";
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
  host: HostId,
  env: NodeJS.ProcessEnv = process.env,
): HostPaths {
  const configDir =
    host === "claude-code"
      ? (env["CLAUDE_CONFIG_DIR"] ?? join(homedir(), ".claude"))
      : (env["CODEX_HOME"] ?? join(homedir(), ".codex"));
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
export function detectHosts(env: NodeJS.ProcessEnv = process.env): HostId[] {
  const hosts: HostId[] = [];
  if (
    existsSync(hostPaths("claude-code", env).configDir) ||
    commandOnPath("claude", env["PATH"])
  ) {
    hosts.push("claude-code");
  }
  if (
    existsSync(hostPaths("codex", env).configDir) ||
    commandOnPath("codex", env["PATH"])
  ) {
    hosts.push("codex");
  }
  return hosts;
}

/**
 * Install or refresh the AeChat skill for one host. The file is product-owned:
 * an existing different file is replaced so an upgrade cannot leave an old
 * skill in place.
 */
export function installHostSkill(options: {
  host: HostId;
  sourceRoot?: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
}): InstallResult {
  const source = join(
    options.sourceRoot ?? skillSourceRoot(),
    options.host,
    "SKILL.md",
  );
  let content: string;
  try {
    content = readFileSync(source, "utf8");
  } catch {
    throw new AechatError("internal", `bundled skill is missing: ${source}`);
  }

  const target = hostPaths(options.host, options.env).skillFile;
  const exists = existsSync(target);
  const same = exists && readFileSync(target, "utf8") === content;
  if (same) {
    return { host: options.host, path: target, action: "up-to-date" };
  }

  if (options.dryRun !== true) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: "utf8", mode: 0o644 });
  }
  return {
    host: options.host,
    path: target,
    action: exists ? "updated" : "installed",
  };
}
