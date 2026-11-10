import { readFileSync } from "node:fs";

import { hostById, hostSessionId } from "../../adapters/hosts/registry.js";
import { AechatError } from "../../core/errors.js";
import type { Session } from "../../core/services/session-service.js";
import type { Client } from "../../core/types.js";
import { parseArgs } from "../args.js";
import type { CommandContext } from "./context.js";

/** Codex hooks receive the thread id in their stdin JSON, not the env. */
export function hookSessionId(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const id = (parsed as { session_id?: unknown }).session_id;
    return typeof id === "string" && id !== "" ? id : undefined;
  } catch {
    return undefined;
  }
}

function bindDirective(binding: {
  evidenceJson: string | null;
}): string | null {
  if (binding.evidenceJson === null) {
    return null;
  }
  try {
    const evidence: unknown = JSON.parse(binding.evidenceJson);
    if (typeof evidence !== "object" || evidence === null) {
      return null;
    }
    const directive = (evidence as { bindDirective?: unknown }).bindDirective;
    return typeof directive === "string" ? directive : null;
  } catch {
    return null;
  }
}

function sessionDto(session: Session): Record<string, unknown> {
  return {
    session_id: session.sessionId,
    display_name: session.displayName,
    client: session.client,
    project: session.project,
    conversation_id: session.conversationId,
    bound_scope: session.boundScope,
    bound_state: session.boundScope === "none" ? "invalid" : "valid",
    bound_checked_at: session.boundCheckedAt,
    last_seen_at: session.lastSeenAt,
  };
}

/**
 * Idempotent host-start attach: reuse the session for this conversation and
 * reclaim its role, or register one when the conversation is new. Intended to
 * run from a host SessionStart hook, where the session id cannot be chosen.
 */
export async function attachCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const client = args.values.get("client");
  if (client === undefined || client === "") {
    throw new AechatError("invalid_input", "attach requires --client <host>");
  }
  const host = hostById(client);
  if (host === undefined) {
    throw new AechatError(
      "invalid_input",
      `attach requires a declared host client, received: ${client}`,
    );
  }
  let conversationId = hostSessionId(host);
  if (args.flags.has("stdin-session")) {
    let raw = "";
    try {
      raw = readFileSync(0, "utf8");
    } catch {
      raw = "";
    }
    conversationId = hookSessionId(raw) ?? conversationId;
  }
  if (conversationId === undefined) {
    throw new AechatError(
      "invalid_input",
      `no host session id (${host.sessionEnv} or hook stdin) available`,
    );
  }
  const project = args.values.get("project") ?? process.cwd();
  const name = args.values.get("name");
  const result = await ctx.service.attach({
    ...(name === undefined || name === "" ? {} : { displayName: name }),
    client: host.id as Client,
    project,
    conversationId,
    hostSessionId: conversationId,
  });
  const claim = result.claim;
  const holdsRole =
    claim.transportClaimState === "accepted" ||
    claim.transportClaimState === "unknown";
  const bound = claim.claimed;
  return {
    ...sessionDto(result.session),
    bound_scope: bound ? claim.boundScope : "none",
    bound_state: bound ? "valid" : "invalid",
    binding_state: bound ? "bound" : claim.bindingState,
    attached: result.attached,
    address: result.binding.address,
    bind_directive: bound || holdsRole ? null : bindDirective(result.binding),
    auto_bind: {
      claimed: claim.claimed,
      boundScope: claim.boundScope,
      transportClaimState: claim.transportClaimState,
      bindingState: claim.bindingState,
      ...(claim.reason === undefined ? {} : { reason: claim.reason }),
      ...(claim.warnings === undefined ? {} : { warnings: claim.warnings }),
    },
  };
}
