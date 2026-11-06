import { AechatError } from "../../core/errors.js";
import type { CommandContext } from "./context.js";
import { parseArgs } from "../args.js";

export function whoamiCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Record<string, unknown> {
  const args = parseArgs(argv);
  const sessionId = args.values.get("session");
  const conversationId = args.values.get("conversation");
  if ((sessionId === undefined) === (conversationId === undefined)) {
    throw new AechatError(
      "invalid_input",
      "whoami requires exactly one of --session or --conversation",
    );
  }

  const session =
    sessionId !== undefined
      ? ctx.service.whoami({ sessionId })
      : ctx.service.whoami({ conversationId: conversationId as string });

  return {
    session_id: session.sessionId,
    display_name: session.displayName,
    client: session.client,
    project: session.project,
    conversation_id: session.conversationId,
    bound_scope: session.boundScope,
    bound_checked_at: session.boundCheckedAt,
    last_seen_at: session.lastSeenAt,
    host_seen_at: session.hostSeenAt,
  };
}
