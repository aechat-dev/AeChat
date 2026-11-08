import { AechatError } from "../../core/errors.js";
import type {
  ClaimResult,
  Session,
} from "../../core/services/session-service.js";
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

/**
 * The host session id agmsg uses for its actas locks. AGMSG_SESSION_ID is the
 * explicit override; otherwise Claude Code exports CLAUDE_CODE_SESSION_ID and
 * Codex exports CODEX_THREAD_ID.
 */
function hostSessionEnv(client: "claude-code" | "codex"): {
  name: string;
  value?: string;
} {
  const shared = process.env["AGMSG_SESSION_ID"];
  if (shared !== undefined && shared !== "") {
    return { name: "AGMSG_SESSION_ID", value: shared };
  }
  const name =
    client === "claude-code" ? "CLAUDE_CODE_SESSION_ID" : "CODEX_THREAD_ID";
  const value = process.env[name];
  return value === undefined || value === "" ? { name } : { name, value };
}

function autoBindView(result: ClaimResult): Record<string, unknown> {
  return {
    claimed: result.claimed,
    boundScope: result.boundScope,
    transportClaimed: result.transportClaimed,
    bindingState: result.bindingState,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
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

  let autoClaim: ClaimResult | undefined;
  let skipReason: string | undefined;
  if (args.flags.has("no-bind")) {
    skipReason = "disabled by --no-bind";
  } else if (client === "other") {
    skipReason = "client other has no host session";
  } else {
    const host = hostSessionEnv(client as "claude-code" | "codex");
    if (host.value === undefined) {
      skipReason = `no host session id (${host.name}) in the environment`;
    } else {
      try {
        autoClaim = await ctx.service.claim(
          result.session.sessionId,
          host.value,
        );
      } catch (error) {
        autoClaim = {
          claimed: false,
          boundScope: "none",
          transportClaimed: false,
          bindingState: result.binding.state,
          session: result.session,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const bound = autoClaim?.claimed === true;
  const session = autoClaim?.session ?? result.session;
  const bindingState = autoClaim?.bindingState ?? result.binding.state;
  // A successful claim that could not be verified still holds the transport
  // role. Returning the bind directive would collide with that lock, so point
  // the caller at `confirm`/`leave` through auto_bind.reason instead.
  const holdsRole = autoClaim?.transportClaimed === true;

  return {
    ...sessionDto(session),
    address: result.binding.address,
    bound_state: bound ? "valid" : "invalid",
    bound_scope: bound ? (autoClaim?.boundScope ?? "none") : "none",
    binding_state: bound ? "bound" : bindingState,
    bind_directive: bound || holdsRole ? null : result.bindDirective,
    auto_bind:
      autoClaim === undefined
        ? {
            claimed: false,
            boundScope: "none",
            transportClaimed: false,
            bindingState,
            reason: skipReason,
          }
        : autoBindView(autoClaim),
  };
}
