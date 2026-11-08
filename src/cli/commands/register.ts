import {
  hostById,
  hostSessionId,
  SHARED_SESSION_ENV,
} from "../../adapters/hosts/registry.js";
import { AechatError } from "../../core/errors.js";
import type {
  ClaimResult,
  Session,
} from "../../core/services/session-service.js";
import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

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

const CLIENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isClient(value: string): boolean {
  return value === "other" || CLIENT_PATTERN.test(value);
}

function autoBindView(result: ClaimResult): Record<string, unknown> {
  return {
    claimed: result.claimed,
    boundScope: result.boundScope,
    transportClaimState: result.transportClaimState,
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
  if (!isClient(client)) {
    throw new AechatError(
      "invalid_input",
      `invalid --client ${client}; expected a host id or other`,
    );
  }
  const project = args.values.get("project") ?? process.cwd();

  // Conversation/thread IDs are host evidence, never a user-supplied CLI
  // shortcut: accepting one here would let a caller fake conversation binding.
  const result = await ctx.service.register({
    displayName,
    client,
    project,
  });

  let autoClaim: ClaimResult | undefined;
  let skipReason: string | undefined;
  const host = hostById(client);
  if (args.flags.has("no-bind")) {
    skipReason = "disabled by --no-bind";
  } else if (client === "other") {
    skipReason = "client other has no host session";
  } else {
    const shared = process.env[SHARED_SESSION_ENV];
    const hostSession =
      host === undefined
        ? shared === undefined || shared === ""
          ? undefined
          : shared
        : hostSessionId(host);
    if (hostSession === undefined) {
      skipReason =
        host === undefined
          ? `no host descriptor for client ${client}; set ${SHARED_SESSION_ENV} to bind`
          : `no host session id (${SHARED_SESSION_ENV} or ${host.sessionEnv}) in the environment`;
    } else {
      try {
        autoClaim = await ctx.service.claim(
          result.session.sessionId,
          hostSession,
        );
      } catch (error) {
        autoClaim = {
          claimed: false,
          boundScope: "none",
          // The service failed unexpectedly; treat the role as possibly held
          // so the caller is never sent into a second actas attempt.
          transportClaimState: "unknown",
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
  // An accepted or unknown claim may hold the transport role even when the
  // binding was not confirmed. Returning the bind directive would collide
  // with that lock, so point at `confirm`/`leave` through auto_bind.reason.
  const holdsRole =
    autoClaim?.transportClaimState === "accepted" ||
    autoClaim?.transportClaimState === "unknown";

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
            transportClaimState: "not-attempted",
            bindingState,
            reason: skipReason,
          }
        : autoBindView(autoClaim),
  };
}
