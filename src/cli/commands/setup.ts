import { installCodexHooks } from "../../adapters/hosts/codex.js";
import { hostById } from "../../adapters/hosts/registry.js";
import { AechatError } from "../../core/errors.js";
import { installHostSkill } from "../../runtime/host-install.js";
import { parseArgs } from "../args.js";
import type { CommandResult } from "../output.js";

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
  if (args.flags.has("hooks") && hostArg !== "codex") {
    throw new AechatError(
      "invalid_input",
      `--hooks is not supported for ${hostArg}; only codex has an agmsg hook installer`,
    );
  }
  const dryRun = args.flags.has("dry-run");
  const result = installHostSkill({ host: hostArg, dryRun });
  const hooks =
    hostArg === "codex" && args.flags.has("hooks")
      ? await installCodexHooks({
          project: args.values.get("project") ?? process.cwd(),
          dryRun,
        })
      : undefined;
  const data = hooks === undefined ? result : { ...result, hooks };

  if (args.flags.has("json")) {
    return { data };
  }
  const lines = [`${result.host} skill: ${result.action} -> ${result.path}`];
  if (hooks !== undefined) {
    lines.push(
      `codex delivery: ${hooks.action} (${hooks.mode} -> ${hooks.path})`,
    );
  }
  return { data, text: `${lines.join("\n")}\n` };
}
