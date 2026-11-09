import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AechatError } from "../../core/errors.js";

export interface CodexHookOptions {
  project: string;
  env?: NodeJS.ProcessEnv;
  scriptsDir?: string;
  dryRun?: boolean;
  runner?: (
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stdout?: string; stderr: string }>;
}

export type CodexDeliveryMode = "agmsgd" | "monitor";

export interface CodexHookResult {
  action: "configured" | "up-to-date" | "would-configure";
  /** The delivery path AeChat selected for this project. */
  mode: CodexDeliveryMode;
  /** The project's hooks file; agmsg also writes it on the agmsgd path. */
  path: string;
}

export function codexHooksPath(project: string): string {
  return join(project, ".codex", "hooks.json");
}

function defaultRunner(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : (((error as { code?: unknown }).code as number | undefined) ?? 1);
        // ENOENT/EACCES leave stderr empty; surface the exec error text so the
        // CLI failure names the missing script instead of an empty reason.
        const detail =
          stderr.trim() === "" && error !== null ? error.message : stderr;
        resolve({
          exitCode: typeof code === "number" ? code : 1,
          stdout,
          stderr: detail,
        });
      },
    );
  });
}

function alreadyConfigured(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    const text = readFileSync(path, "utf8");
    return text.includes("agmsg") && text.includes("session-start.sh");
  } catch {
    return false;
  }
}

function scriptsDir(options: CodexHookOptions): string {
  const env = options.env ?? process.env;
  return (
    options.scriptsDir ??
    join(
      env["AGMSG_HOME"] ?? join(homedir(), ".agents", "skills", "agmsg"),
      "scripts",
    )
  );
}

/**
 * agmsg's offer states. `not-running` means the user already turned agmsgd on
 * but the service is not confirmed running; `agmsg delivery agmsgd` starts it,
 * so it is a candidate, not a reason to fall back to the legacy bridge.
 */
async function agmsgdState(
  dir: string,
  runner: NonNullable<CodexHookOptions["runner"]>,
): Promise<string> {
  const result = await runner(
    join(dir, "agmsg"),
    ["daemon", "offer", "codex"],
    10_000,
  );
  if (result.exitCode !== 0) {
    return "unavailable";
  }
  return /agmsgd=([a-z-]+)/.exec(result.stdout ?? "")?.[1] ?? "unavailable";
}

/**
 * Put a Codex project on a delivery path that can actually wake the host.
 *
 * agmsgd is the path that works for the desktop app: it queues notices into
 * the Codex app-server without a shell shim. agmsg still installs the project's
 * SessionStart hook so the hook can start agmsgd's delivery; that hook is
 * independent of the legacy bridge. The legacy monitor bridge only covers
 * terminal launches, so it is a fallback for installs where agmsgd cannot run.
 */
export async function installCodexHooks(
  options: CodexHookOptions,
): Promise<CodexHookResult> {
  const dir = scriptsDir(options);
  const runner = options.runner ?? defaultRunner;
  const dryRun = options.dryRun === true;
  const path = codexHooksPath(options.project);

  const agmsgd = await agmsgdState(dir, runner);
  if (agmsgd === "available" || agmsgd === "on" || agmsgd === "not-running") {
    if (dryRun) {
      return { action: "would-configure", mode: "agmsgd", path };
    }
    const enabled = await runner(
      join(dir, "agmsg"),
      ["delivery", "agmsgd", "--type", "codex", "--project", options.project],
      30_000,
    );
    if (enabled.exitCode !== 0) {
      throw new AechatError(
        "transport_unavailable",
        `could not enable agmsgd for Codex: ${enabled.stderr.trim()}`,
      );
    }
    const status = await runner(
      join(dir, "agmsg"),
      ["delivery", "status", "--type", "codex", "--project", options.project],
      10_000,
    );
    if (
      status.exitCode !== 0 ||
      !/this project:\s*agmsgd/.test(status.stdout ?? "")
    ) {
      throw new AechatError(
        "transport_unavailable",
        "agmsgd reported success but the project is not on agmsgd delivery",
      );
    }
    if (!existsSync(path)) {
      throw new AechatError(
        "transport_unavailable",
        `agmsgd is configured but the SessionStart hook file is missing: ${path}`,
      );
    }
    return { action: "configured", mode: "agmsgd", path };
  }

  if (alreadyConfigured(path)) {
    return { action: "up-to-date", mode: "monitor", path };
  }
  if (dryRun) {
    return { action: "would-configure", mode: "monitor", path };
  }

  const script = join(dir, "delivery.sh");
  const result = await runner(
    script,
    ["set", "monitor", "codex", options.project],
    10_000,
  );
  if (result.exitCode !== 0) {
    throw new AechatError(
      "transport_unavailable",
      `could not configure Codex hooks with agmsg: ${result.stderr.trim()}`,
    );
  }
  if (!existsSync(path)) {
    throw new AechatError(
      "transport_unavailable",
      `agmsg reported success but ${path} is missing`,
    );
  }
  return { action: "configured", mode: "monitor", path };
}
