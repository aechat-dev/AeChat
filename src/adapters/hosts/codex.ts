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
  ) => Promise<{ exitCode: number; stderr: string }>;
}

export interface CodexHookResult {
  action: "configured" | "up-to-date" | "would-configure";
  path: string;
}

export function codexHooksPath(project: string): string {
  return join(project, ".codex", "hooks.json");
}

function defaultRunner(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8" },
      (error, _stdout, stderr) => {
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

/**
 * Put a Codex project into agmsg monitor mode so its SessionStart hook starts
 * the agmsg bridge. AeChat does not reimplement the bridge; this delegates to
 * the installed agmsg scripts and fails loudly when they are unavailable.
 */
export async function installCodexHooks(
  options: CodexHookOptions,
): Promise<CodexHookResult> {
  const path = codexHooksPath(options.project);
  const dryRun = options.dryRun === true;
  if (alreadyConfigured(path)) {
    return { action: "up-to-date", path };
  }
  if (dryRun) {
    return { action: "would-configure", path };
  }

  const env = options.env ?? process.env;
  const scriptsDir =
    options.scriptsDir ??
    join(
      env["AGMSG_HOME"] ?? join(homedir(), ".agents", "skills", "agmsg"),
      "scripts",
    );
  const script = join(scriptsDir, "delivery.sh");
  const result = await (options.runner ?? defaultRunner)(
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
  return { action: "configured", path };
}
