import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
    // `--message=<body>` is one argv token: a body starting with "-" must not
    // be parsed as an option.
    ["queue", "--thread", input.thread, `--message=${input.body}`],
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

export interface CodexPluginOptions {
  /** The `plugins/aechat-codex` directory shipped with AeChat. */
  pluginRoot: string;
  env?: NodeJS.ProcessEnv;
  /** Codex CLI path; an empty string forces the "not found" path. */
  executable?: string;
  dryRun?: boolean;
  runner?: (
    file: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Promise<{ exitCode: number; stdout?: string; stderr: string }>;
}

export interface CodexPluginResult {
  action: "installed" | "would-install" | "failed";
  path: string;
  marketplace: string;
  error?: string;
}

const CODEX_MARKETPLACE = "aechat-local";

function jsonObject(
  stdout: string | undefined,
): Record<string, unknown> | undefined {
  if (stdout === undefined || stdout.trim() === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

function bundledPluginVersion(pluginRoot: string): string | undefined {
  try {
    const manifest = jsonObject(
      readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
    );
    const version = manifest?.["version"];
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Install the SessionStart attach hook as a Codex plugin. Codex trusts a
 * plugin hook once, so this replaces per-project hook files; the project-level
 * hook stays available as a fallback for builds without plugin support.
 */
export async function installCodexPlugin(
  options: CodexPluginOptions,
): Promise<CodexPluginResult> {
  const base = {
    path: options.pluginRoot,
    marketplace: CODEX_MARKETPLACE,
  };
  if (
    !existsSync(join(options.pluginRoot, ".claude-plugin", "marketplace.json"))
  ) {
    return {
      ...base,
      action: "failed",
      error: `bundled Codex plugin is missing: ${options.pluginRoot}`,
    };
  }
  if (options.dryRun === true) {
    return { ...base, action: "would-install" };
  }
  const executable =
    options.executable ?? (codexExecutable(options.env) || "codex");
  if (executable === "") {
    return {
      ...base,
      action: "failed",
      error:
        "Codex CLI not found; set AECHAT_CODEX_BIN to the desktop app's codex binary",
    };
  }
  const runner = options.runner ?? runnerWithEnv(options.env ?? process.env);
  const added = await runner(
    executable,
    ["plugin", "marketplace", "add", options.pluginRoot, "--json"],
    60_000,
  );
  if (added.exitCode !== 0) {
    const detail = `${added.stderr}${added.stdout ?? ""}`.trim();
    return {
      ...base,
      action: "failed",
      error: /different source/i.test(detail)
        ? `marketplace ${CODEX_MARKETPLACE} points at another source; ` +
          `run \`codex plugin marketplace remove ${CODEX_MARKETPLACE}\` and retry`
        : `could not add the Codex marketplace: ${detail}`,
    };
  }
  const addedRoot = jsonObject(added.stdout)?.["installedRoot"];
  if (
    typeof addedRoot === "string" &&
    !samePath(addedRoot, options.pluginRoot)
  ) {
    return {
      ...base,
      action: "failed",
      error:
        `marketplace ${CODEX_MARKETPLACE} resolves to ${addedRoot}, ` +
        `expected ${options.pluginRoot}; remove it and retry`,
    };
  }

  const installed = await runner(
    executable,
    ["plugin", "add", `aechat-codex@${CODEX_MARKETPLACE}`, "--json"],
    60_000,
  );
  if (installed.exitCode !== 0) {
    return {
      ...base,
      action: "failed",
      error: `could not install the Codex plugin: ${installed.stderr.trim()}`,
    };
  }
  const installedJson = jsonObject(installed.stdout);
  const installedVersion = installedJson?.["version"];
  const bundled = bundledPluginVersion(options.pluginRoot);
  if (
    typeof installedVersion === "string" &&
    bundled !== undefined &&
    installedVersion !== bundled
  ) {
    return {
      ...base,
      action: "failed",
      error:
        `Codex installed plugin ${installedVersion}, but AeChat bundles ` +
        `${bundled}; remove marketplace ${CODEX_MARKETPLACE} and retry`,
    };
  }
  return { ...base, action: "installed" };
}
