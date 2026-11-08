import { AechatError } from "../../core/errors.js";
import { wakeupLevelOf } from "../../core/services/capability-service.js";
import { parseArgs, requiredValue } from "../args.js";
import type { CommandContext } from "./context.js";

function parseEvidence(json: string | null): Record<string, unknown> {
  if (json === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Runs one capability probe and records its evidence. The output is the raw
 * observation, not a promise: an adapter that cannot prove a level reports
 * `unknown` and null booleans.
 */
export async function probeCommand(
  argv: readonly string[],
  ctx: CommandContext,
): Promise<Record<string, unknown>> {
  const args = parseArgs(argv);
  const sessionId = requiredValue(args, "session");
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new AechatError("invalid_input", "invalid session id for probe");
  }

  const probe = await ctx.capabilities.probe(sessionId);
  return {
    session_id: probe.sessionId,
    probe_id: probe.probeId,
    client: probe.client,
    client_version: probe.clientVersion,
    observed_level: wakeupLevelOf(probe.observedLevel),
    busy_receive: probe.busyReceive,
    idle_wakeup: probe.idleWakeup,
    observed_at: probe.observedAt,
    evidence: parseEvidence(probe.evidenceJson),
  };
}
