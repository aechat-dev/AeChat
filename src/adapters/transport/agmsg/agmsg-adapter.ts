import { AechatError } from "../../../core/errors.js";
import { redactErrorDetail } from "../../../core/log-redaction.js";
import type {
  BindResult,
  CapabilityEvidence,
  NotifyResult,
  SessionRef,
  TransportAdapter,
  TransportBinding,
  TransportStatus,
} from "../../../core/transport/adapter.js";
import type { AgmsgCliPort } from "./agmsg-cli.js";
import {
  ADDRESS_PATTERN,
  bindDirectiveFor,
  generateAddress,
  hasAddress,
  parseLockState,
} from "./mapping.js";

export interface DirectDeliveryInput {
  client: string;
  project: string;
  conversationId: string;
  messageId: string;
  body: string;
}

export interface DirectDeliveryResult {
  ok: boolean;
  error?: string;
}

/**
 * Host-specific direct injection (for example Codex's thread queue). When it
 * is configured for a Codex target, the body goes into the conversation and
 * the agmsg pointer is not sent.
 */
export type DirectDelivery = (
  input: DirectDeliveryInput,
) => Promise<DirectDeliveryResult>;

export interface AgmsgAdapterOptions {
  cli: AgmsgCliPort;
  team: string;
  directDelivery?: DirectDelivery;
}

/**
 * agmsg transport adapter. Core never sees team/role fields; this adapter maps
 * the generic session identity onto one agmsg agent address.
 */
export class AgmsgAdapter implements TransportAdapter {
  readonly name = "agmsg";

  private readonly cli: AgmsgCliPort;
  private readonly team: string;
  private readonly directDelivery: DirectDelivery | undefined;

  constructor(options: AgmsgAdapterOptions) {
    this.cli = options.cli;
    this.team = options.team;
    this.directDelivery = options.directDelivery;
  }

  async register(
    session: SessionRef,
    desiredAddress?: string,
  ): Promise<TransportBinding> {
    const address = desiredAddress ?? generateAddress();
    if (!ADDRESS_PATTERN.test(address)) {
      throw new AechatError(
        "invalid_name",
        `invalid agmsg address: ${address}; expected aechat-<12 lowercase hex>`,
      );
    }

    await this.cli.version();
    const joined = await this.cli.join({
      team: this.team,
      address,
      client: session.client,
      project: session.project,
    });
    if (!joined.ok) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg join failed: ${joined.stderr}`,
      );
    }

    // The delivery mode comes from the project's actual configuration, not
    // from an assumption that every agmsg project uses monitor mode.
    let mode = "unknown";
    try {
      const doctor = await this.cli.doctorStatus(
        this.team,
        session.client,
        session.project,
      );
      mode = doctor.mode;
    } catch {
      mode = "unknown";
    }

    return {
      transport: this.name,
      address,
      team: this.team,
      mode,
      state: "pending",
      evidence: {
        joined: true,
        client: session.client,
        project: session.project,
        mode,
        bindDirective: bindDirectiveFor(session.client, address),
      },
      bindDirective: bindDirectiveFor(session.client, address),
    };
  }

  async bind(
    session: SessionRef,
    binding: TransportBinding,
  ): Promise<BindResult> {
    const teamName = binding.team ?? this.team;
    const team = await this.cli.teamJson(teamName);
    if (!hasAddress(team, binding.address)) {
      return {
        state: "failed",
        boundScope: "none",
        conversationId: null,
        mode: null,
        evidence: { roster: false },
        reason: "address is not registered in the agmsg roster",
      };
    }

    const doctor = await this.cli.doctorStatus(
      teamName,
      session.client,
      session.project,
    );
    const lock = parseLockState(doctor.locks[`${teamName}/${binding.address}`]);
    if (lock !== "alive") {
      return {
        state: lock === "stale" ? "stale" : "pending",
        boundScope: "none",
        conversationId: null,
        mode: doctor.mode,
        evidence: { roster: true, lock },
        reason:
          lock === "stale"
            ? "actas lock owner is not alive"
            : "no live actas lock for this address",
      };
    }

    // A live actas lock proves the role is held by a live host session, not
    // that it is the current conversation. Keep the honest weaker scope.
    return {
      state: "bound",
      boundScope: "host_role",
      conversationId: null,
      mode: doctor.mode,
      evidence: { roster: true, lock, conversationMatched: false },
    };
  }

  async claim(
    session: SessionRef,
    binding: TransportBinding,
    hostSessionId: string,
  ): Promise<NotifyResult> {
    const result = await this.cli.claim({
      project: session.project,
      client: session.client,
      address: binding.address,
      sessionId: hostSessionId,
    });
    if (!result.ok) {
      return { ok: false, error: result.stderr };
    }
    if (session.client === "codex") {
      // agmsgd addresses a Codex seat by its recorded thread. The actas claim
      // alone leaves role_session_missing, so record the thread now; a failure
      // degrades to pull-only rather than rejecting the claim.
      const recorded = await this.cli
        .recordCodexSession({
          team: binding.team ?? this.team,
          agent: binding.address,
          project: session.project,
          sessionId: hostSessionId,
        })
        .catch((error: unknown) => ({
          ok: false,
          stderr: error instanceof Error ? error.message : String(error),
        }));
      if (!recorded.ok) {
        return {
          ok: true,
          warning:
            "Codex thread was not recorded for agmsgd; delivery may stay pull-only " +
            `(${recorded.stderr.trim() || "no detail"})`,
        };
      }
    }
    return { ok: true };
  }

  async notify(
    binding: TransportBinding,
    notification: {
      messageId: string;
      fromSession: string;
      toSession: string;
      fromAddress?: string;
      body?: string;
      kind?: string;
      fromName?: string;
      conversationId?: string | null;
      targetClient?: string;
      targetProject?: string;
    },
  ): Promise<NotifyResult> {
    // Codex desktop owns a thread queue: inject the body as a user turn
    // instead of asking the agent to pull a pointer. A failure is reported,
    // not silently downgraded to the indirect path.
    if (
      this.directDelivery !== undefined &&
      notification.targetClient === "codex"
    ) {
      if (
        notification.body === undefined ||
        notification.conversationId === undefined ||
        notification.conversationId === null
      ) {
        return {
          ok: false,
          error:
            "Codex direct delivery needs the message body and the thread id; " +
            "run aechat attach so the session records its conversation id",
        };
      }
      const kind = notification.kind ?? "notify";
      const header =
        `[AeChat] message=${notification.messageId} kind=${kind} ` +
        `from=${notification.fromName ?? notification.fromSession}`;
      const footer =
        kind === "request"
          ? `\n\n[AeChat request=${notification.messageId}; ` +
            `reply: aechat reply --session ${notification.toSession} ` +
            `--request ${notification.messageId} --body "..."]`
          : "";
      return this.directDelivery({
        client: "codex",
        project: notification.targetProject ?? "",
        conversationId: notification.conversationId,
        messageId: notification.messageId,
        body: `${header}\n${notification.body}${footer}`,
      });
    }
    const result = await this.cli.notify({
      team: binding.team ?? this.team,
      from: notification.fromAddress ?? notification.fromSession,
      to: binding.address,
      // Pointer only: the target pulls the body from AeChat. Never put the
      // body or display name into transport text.
      text:
        `[AeChat] msg=${notification.messageId} ` +
        `session=${notification.toSession} ` +
        `use_skill=aechat ` +
        `action=aechat inbox --session ${notification.toSession}`,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.stderr };
  }

  async inspect(binding: TransportBinding): Promise<TransportStatus> {
    try {
      const teamName = binding.team ?? this.team;
      const team = await this.cli.teamJson(teamName);
      if (!hasAddress(team, binding.address)) {
        return {
          state: "dead",
          at: new Date().toISOString(),
          evidence: { roster: false },
        };
      }
      // Roster membership alone is not liveness: the role must still be held
      // by a live actas lock. A project can be configured without any host
      // session actually claiming the address.
      const client =
        typeof binding.evidence["client"] === "string"
          ? binding.evidence["client"]
          : "claude-code";
      const project =
        typeof binding.evidence["project"] === "string"
          ? binding.evidence["project"]
          : "";
      const doctor = await this.cli.doctorStatus(teamName, client, project);
      const lock = parseLockState(
        doctor.locks[`${teamName}/${binding.address}`],
      );
      return {
        state:
          lock === "alive" ? "live" : lock === "stale" ? "dead" : "unknown",
        at: new Date().toISOString(),
        evidence: { roster: true, lock },
      };
    } catch {
      return { state: "unknown", evidence: { roster: null } };
    }
  }

  async release(binding: TransportBinding): Promise<void> {
    await this.cli.leave(binding.team ?? this.team, binding.address);
  }

  /**
   * Records transport facts only. A mode or a live lock says the role is held,
   * not that a host processed a message or woke from idle, so the level stays
   * unknown until a real host observation provides that evidence.
   */
  async probe(binding: TransportBinding): Promise<CapabilityEvidence> {
    const at = new Date().toISOString();
    const base = {
      observedLevel: "unknown" as const,
      pull: null,
      wait: null,
      notificationReceive: null,
      busyReceive: null,
      idleWakeup: null,
      at,
    };
    const client = binding.evidence["client"];
    const project = binding.evidence["project"];
    if (typeof client !== "string" || typeof project !== "string") {
      return {
        ...base,
        evidence: { probe: "binding lacks client/project evidence" },
      };
    }

    let stage = "team";
    try {
      const teamName = binding.team ?? this.team;
      const team = await this.cli.teamJson(teamName);
      stage = "doctor";
      const doctor = await this.cli.doctorStatus(teamName, client, project);
      return {
        ...base,
        evidence: {
          probe: "transport facts only",
          roster: hasAddress(team, binding.address),
          lock: parseLockState(doctor.locks[`${teamName}/${binding.address}`]),
          mode: doctor.mode,
        },
      };
    } catch (error) {
      // CLI errors can carry paths and tokens; store the same redacted form
      // used by the audit log.
      return {
        ...base,
        evidence: {
          probe: "transport facts unavailable",
          stage,
          error: redactErrorDetail(
            error instanceof Error ? error.message : String(error),
          ),
        },
      };
    }
  }
}
