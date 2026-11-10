import { fileURLToPath } from "node:url";

import { installClaudeHook } from "../../adapters/hosts/claude-code.js";
import {
  codexHooksPath,
  installCodexHooks,
  installCodexPlugin,
  removeAttachHook,
} from "../../adapters/hosts/codex.js";
import { hostById, hostHookPath } from "../../adapters/hosts/registry.js";
import { AechatError } from "../../core/errors.js";
import {
  codexPluginRoot,
  installHostSkill,
} from "../../runtime/host-install.js";
import { parseArgs } from "../args.js";
import type { CommandResult } from "../output.js";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function cliEntry(): string {
  // setup.js is not an entry point: running it is a silent no-op. Use the
  // actual CLI entry when this process was started through main, and fall
  // back to the sibling main.js in a bundled install.
  const running = process.argv[1];
  if (running !== undefined && /(?:^|\/)main\.(?:js|ts)$/.test(running)) {
    return running;
  }
  return fileURLToPath(new URL("../main.js", import.meta.url));
}

export function attachCommand(project: string, client = "codex"): string {
  // SessionStart runs with the host's non-interactive environment, which may
  // not resolve `aechat`; pin the current node binary and CLI path.
  return (
    `${shellQuote(process.execPath)} ${shellQuote(cliEntry())} attach ` +
    `--client ${client} --project ${shellQuote(project)} --stdin-session ` +
    "--json >/dev/null 2>&1 || true"
  );
}

export async function setupCommand(
  argv: readonly string[],
): Promise<CommandResult> {
  const [hostArg, ...rest] = argv;
  if (hostArg === undefined) {
    throw new AechatError("invalid_input", "usage: aechat setup <host>");
  }
  if (hostById(hostArg) === undefined) {
    throw new AechatError(
      "invalid_input",
      `unknown host ${hostArg}; expected a host declared by an adapter`,
    );
  }
  const args = parseArgs(rest);
  if (
    args.flags.has("hooks") &&
    hostArg !== "codex" &&
    hostArg !== "claude-code"
  ) {
    throw new AechatError(
      "invalid_input",
      `--hooks is not supported for ${hostArg}; ` +
        "only codex and claude-code have a SessionStart hook installer",
    );
  }
  if (args.flags.has("plugin") && hostArg !== "codex") {
    throw new AechatError(
      "invalid_input",
      `--plugin is not supported for ${hostArg}; only codex has a plugin package`,
    );
  }
  const dryRun = args.flags.has("dry-run");
  const project = args.values.get("project") ?? process.cwd();
  const result = installHostSkill({ host: hostArg, dryRun });
  const codexHooks =
    hostArg === "codex" && args.flags.has("hooks")
      ? await installCodexHooks({
          project,
          dryRun,
          attachCommand: attachCommand(project),
        })
      : undefined;
  const claudeSettings =
    hostArg === "claude-code" ? hostHookPath("claude-code") : undefined;
  const claudeHook =
    hostArg === "claude-code" &&
    args.flags.has("hooks") &&
    claudeSettings !== undefined
      ? installClaudeHook({
          settingsPath: claudeSettings,
          command: attachCommand(project, "claude-code"),
          dryRun,
        })
      : undefined;
  const hooks = codexHooks ?? claudeHook;
  const plugin =
    hostArg === "codex" && args.flags.has("plugin")
      ? await installCodexPlugin({ pluginRoot: codexPluginRoot(), dryRun })
      : undefined;
  if (plugin?.action === "failed") {
    throw new AechatError(
      "transport_unavailable",
      plugin.error ?? "could not install the Codex plugin",
    );
  }
  const projectHook =
    plugin === undefined
      ? undefined
      : removeAttachHook(codexHooksPath(project), dryRun);
  const data =
    hooks === undefined && plugin === undefined
      ? result
      : {
          ...result,
          ...(hooks === undefined ? {} : { hooks }),
          ...(plugin === undefined ? {} : { plugin }),
          ...(projectHook === undefined
            ? {}
            : { plugin_project_hook: projectHook }),
        };

  if (args.flags.has("json")) {
    return { data };
  }
  const lines = [`${result.host} skill: ${result.action} -> ${result.path}`];
  if (codexHooks !== undefined) {
    lines.push(
      `codex delivery: ${codexHooks.action} (${codexHooks.mode} -> ${codexHooks.path})`,
    );
    lines.push(
      codexHooks.attachHook === "installed"
        ? `codex attach hook: installed (review it in Codex Settings > Hooks; ` +
            "untrusted hooks are skipped on restart)"
        : `codex attach hook: ${codexHooks.attachHook}`,
    );
  }
  if (claudeHook !== undefined) {
    lines.push(
      `claude-code attach hook: ${claudeHook.action} -> ${claudeHook.path}`,
    );
  }
  if (plugin !== undefined) {
    lines.push(
      `codex plugin: ${plugin.action} ` +
        `(aechat-codex@${plugin.marketplace} -> ${plugin.path})`,
    );
    if (plugin.action === "installed") {
      lines.push(
        "codex plugin trust: approve it once in Codex Settings > Hooks, " +
          "then restart Codex",
      );
    }
  }
  if (projectHook === "removed" || projectHook === "would-remove") {
    lines.push(
      `codex project hook: ${projectHook} (the plugin hook replaces it)`,
    );
  }
  return { data, text: `${lines.join("\n")}\n` };
}
