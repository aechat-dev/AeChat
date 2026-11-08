import { AechatError } from "../../core/errors.js";
import type { Session } from "../../core/services/session-service.js";
import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

const CLIENTS = new Set(["claude-code", "codex", "other"]);

function sessionDto(session: Session): Record<string, unknown> {
  return {
    session_id: session.sessionId,
    display_name: session.displayName,
    client: session.client,
    project: session.project,
    conversation_id: session.conversationId,
    bound_scope: session.boundScope,
    bound_state: "invalid",
    bound_checked_at: session.boundCheckedAt,
    last_seen_at: session.lastSeenAt,
    host_seen_at: session.hostSeenAt,
  };
}

export async function registerCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const displayName = requiredValue(args, "name");
  const client = requiredValue(args, "client");
  if (!CLIENTS.has(client)) {
    throw new AechatError(
      "invalid_input",
      `invalid --client ${client}; expected claude-code, codex or other`,
    );
  }
  const project = args.values.get("project") ?? process.cwd();

  // Conversation/thread IDs are host evidence, never a user-supplied CLI
  // shortcut: accepting one here would let a caller fake conversation binding.
  const result = await ctx.service.register({
    displayName,
    client: client as "claude-code" | "codex" | "other",
    project,
  });

  const hostSessionId =
    args.flags.has("no-bind") || client === "other"
      ? undefined
      : client === "claude-code"
        ? process.env["CLAUDE_CODE_SESSION_ID"]
        : process.env["CODEX_SESSION_ID"];

  let autoClaim: Awaited<ReturnType<typeof ctx.service.claim>> | undefined;
  if (hostSessionId !== undefined && hostSessionId !== "") {
    try {
      autoClaim = await ctx.service.claim(
        result.session.sessionId,
        hostSessionId,
      );
    } catch (error) {
      autoClaim = {
        claimed: false,
        boundScope: "none",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const bound = autoClaim?.claimed === true;

  return {
    ...sessionDto(result.session),
    address: result.binding.address,
    bound_state: bound ? "valid" : "invalid",
    bound_scope: bound ? (autoClaim?.boundScope ?? "none") : "none",
    binding_state: bound ? "bound" : result.binding.state,
    bind_directive: bound ? null : result.bindDirective,
    ...(autoClaim === undefined ? {} : { auto_bind: autoClaim }),
  };
}
