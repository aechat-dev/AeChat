import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { AechatError } from "../../core/errors.js";

export interface CodexHookOptions {
  project: string;
  env?: NodeJS.ProcessEnv;
  scriptsDir?: string;
  dryRun?: boolean;
  /** Absolute command run from SessionStart to reattach the conversation. */
  attachCommand?: string;
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
  /** Whether the host-start `aechat attach` hook is present. */
  attachHook: "installed" | "up-to-date" | "skipped";
}

export function codexHooksPath(project: string): string {
  return join(project, ".codex", "hooks.json");
}

const DEFAULT_CODEX_BIN =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const THREAD_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CodexQueueOptions {
  env?: NodeJS.ProcessEnv;
  /** Codex CLI path; an empty string forces the "not found" path. */
  executable?: string;
  timeoutMs?: number;
  runner?: (
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stdout?: string; stderr: string }>;
}

export interface CodexQueueResult {
  ok: boolean;
  error?: string;
}

/** The Codex CLI that owns the desktop thread store. */
export function codexExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["AECHAT_CODEX_BIN"];
  if (configured !== undefined && configured !== "") {
    return configured;
  }
  return existsSync(DEFAULT_CODEX_BIN) ? DEFAULT_CODEX_BIN : "";
}

function runnerWithEnv(
  env: NodeJS.ProcessEnv,
): NonNullable<CodexQueueOptions["runner"]> {
  return (file, args, timeoutMs) =>
    new Promise((resolve) => {
      execFile(
        file,
        [...args],
        { timeout: timeoutMs, maxBuffer: 1024 * 1024, encoding: "utf8", env },
        (error, stdout, stderr) => {
          const code =
            error === null
              ? 0
              : (((error as { code?: unknown }).code as number | undefined) ??
                1);
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

/**
 * Queue the message body as a user turn in an existing Codex thread. This is
 * the desktop app's own queue path; the body appears in the conversation
 * instead of a "go pull your inbox" pointer.
 */
export async function queueCodexMessage(
  input: { thread: string; body: string },
  options: CodexQueueOptions = {},
): Promise<CodexQueueResult> {
  if (!THREAD_ID.test(input.thread)) {
    return { ok: false, error: `invalid Codex thread id: ${input.thread}` };
  }
  if (input.body === "") {
    return { ok: false, error: "message body must not be empty" };
  }
  const executable = options.executable ?? codexExecutable(options.env);
  if (executable === "") {
    return {
      ok: false,
      error:
        "Codex CLI not found; set AECHAT_CODEX_BIN to the desktop app's codex binary",
    };
  }
  const env = options.env ?? process.env;
  const runner = options.runner ?? runnerWithEnv(env);
  const result = await runner(
    executable,
    ["queue", "--thread", input.thread, "--message", input.body],
    options.timeoutMs ?? 30_000,
  );
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error:
        result.stderr.trim() === ""
          ? `codex queue exited ${result.exitCode}`
          : result.stderr.trim(),
    };
  }
  return { ok: true };
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

/**
 * Append AeChat's own SessionStart entry without touching agmsg's. agmsg's
 * delivery.sh strips only agmsg-owned entries, so this survives a re-run.
 */
export function installAttachHook(
  path: string,
  command: string,
): "installed" | "up-to-date" | "skipped" {
  if (!existsSync(path)) {
    return "skipped";
  }
  let root: unknown;
  try {
    root = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return "skipped";
  }
  if (typeof root !== "object" || root === null) {
    return "skipped";
  }
  const hooks = (root as { hooks?: unknown }).hooks;
  if (typeof hooks !== "object" || hooks === null) {
    return "skipped";
  }
  const sessionStart = (hooks as { SessionStart?: unknown }).SessionStart;
  const entries = Array.isArray(sessionStart) ? sessionStart : [];
  const owned = entries.findIndex((entry: unknown) =>
    JSON.stringify(entry).includes("attach --client codex"),
  );
  if (owned >= 0) {
    const entry = entries[owned] as {
      hooks?: Array<{ type?: unknown; command?: unknown }>;
    };
    const current = entry.hooks?.[0]?.command;
    if (current === command) {
      return "up-to-date";
    }
    // Update the existing AeChat entry instead of appending a second one,
    // so a stale CLI/project path from an earlier setup is repaired.
    entry.hooks = [{ type: "command", command }];
    writeFileSync(path, JSON.stringify(root), "utf8");
    return "installed";
  }
  entries.push({
    matcher: "",
    hooks: [{ type: "command", command }],
  });
  (hooks as { SessionStart?: unknown }).SessionStart = entries;
  writeFileSync(path, JSON.stringify(root), "utf8");
  return "installed";
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

  const attachHook = (): "installed" | "up-to-date" | "skipped" =>
    options.attachCommand === undefined
      ? "skipped"
      : installAttachHook(path, options.attachCommand);
  const agmsgd = await agmsgdState(dir, runner);
  if (agmsgd === "available" || agmsgd === "on" || agmsgd === "not-running") {
    if (dryRun) {
      return {
        action: "would-configure",
        mode: "agmsgd",
        path,
        attachHook: "skipped",
      };
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
    return {
      action: "configured",
      mode: "agmsgd",
      path,
      attachHook: attachHook(),
    };
  }

  if (alreadyConfigured(path)) {
    return {
      action: "up-to-date",
      mode: "monitor",
      path,
      attachHook: attachHook(),
    };
  }
  if (dryRun) {
    return {
      action: "would-configure",
      mode: "monitor",
      path,
      attachHook: "skipped",
    };
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
  return {
    action: "configured",
    mode: "monitor",
    path,
    attachHook: attachHook(),
  };
}
