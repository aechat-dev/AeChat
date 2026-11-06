import { AechatError } from "../../core/errors.js";
import type { Session } from "../../core/services/session-service.js";
import type { CommandContext } from "./context.js";
import { parseArgs, requiredValue } from "../args.js";

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

  return {
    ...sessionDto(result.session),
    address: result.binding.address,
    binding_state: result.binding.state,
    bind_directive: result.bindDirective,
  };
}
