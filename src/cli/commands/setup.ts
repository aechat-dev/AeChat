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
  const result = installHostSkill({
    host: hostArg,
    dryRun: args.flags.has("dry-run"),
  });

  if (args.flags.has("json")) {
    return { data: result };
  }
  return {
    data: result,
    text: `${result.host} skill: ${result.action} -> ${result.path}\n`,
  };
}
