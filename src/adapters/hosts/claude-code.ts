import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClaudeHookOptions {
  /** The host's settings.json (usually $CLAUDE_CONFIG_DIR/settings.json). */
  settingsPath: string;
  /** Command run at SessionStart to reattach the conversation. */
  command: string;
  dryRun?: boolean;
}

export interface ClaudeHookResult {
  action:
    | "installed"
    | "up-to-date"
    | "would-install"
    | "would-update"
    | "skipped";
  path: string;
}

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

function isAttachEntry(entry: unknown): boolean {
  return JSON.stringify(entry).includes("attach --client claude-code");
}

/**
 * Install AeChat's SessionStart entry into Claude Code's user settings. The
 * host runs it on startup/resume/clear, so a new process reattaches instead of
 * waiting for the skill to be invoked. Existing hooks are preserved.
 */
export function installClaudeHook(
  options: ClaudeHookOptions,
): ClaudeHookResult {
  const { settingsPath, command } = options;
  let root: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) {
        return { action: "skipped", path: settingsPath };
      }
      root = parsed as Record<string, unknown>;
    } catch {
      return { action: "skipped", path: settingsPath };
    }
  }
  const hooksValue = root["hooks"];
  const hooks =
    typeof hooksValue === "object" && hooksValue !== null
      ? (hooksValue as Record<string, unknown>)
      : {};
  const sessionValue = hooks["SessionStart"];
  const entries = Array.isArray(sessionValue)
    ? (sessionValue as HookEntry[])
    : [];
  const owned = entries.findIndex((entry) => isAttachEntry(entry));
  const dryRun = options.dryRun === true;

  if (owned >= 0) {
    const entry = entries[owned];
    if (entry === undefined) {
      return { action: "skipped", path: settingsPath };
    }
    if (entry.hooks?.[0]?.command === command) {
      return { action: "up-to-date", path: settingsPath };
    }
    if (dryRun) {
      return { action: "would-update", path: settingsPath };
    }
    entry.hooks = [{ type: "command", command }];
  } else {
    if (dryRun) {
      return { action: "would-install", path: settingsPath };
    }
    entries.push({ matcher: "", hooks: [{ type: "command", command }] });
  }

  hooks["SessionStart"] = entries;
  root["hooks"] = hooks;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(root, null, 2)}\n`, "utf8");
  return { action: "installed", path: settingsPath };
}
