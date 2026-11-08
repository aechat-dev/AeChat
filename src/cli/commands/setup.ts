import { AechatError } from "../../core/errors.js";
import { type HostId, installHostSkill } from "../../runtime/host-install.js";
import { parseArgs } from "../args.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

const HOSTS: HostId[] = ["claude-code", "codex"];

function isHost(value: string): value is HostId {
  return (HOSTS as string[]).includes(value);
}

export async function setupCommand(
  argv: readonly string[],
  _ctx: CommandContext,
): Promise<CommandResult> {
  const [hostArg, ...rest] = argv;
  if (hostArg === undefined) {
    throw new AechatError(
      "invalid_input",
      "usage: aechat setup <claude-code|codex>",
    );
  }
  if (!isHost(hostArg)) {
    throw new AechatError(
      "invalid_input",
      `unknown host ${hostArg}; expected claude-code or codex`,
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
