import type { DatabaseSync } from "node:sqlite";

import { AechatError } from "../errors.js";
import { newId } from "../ids.js";
import { validateClient, validateDisplayName } from "../names.js";
import { withImmediate } from "../store/db.js";
import type { EventRepository } from "../store/events.js";
import type { RequestRepository } from "../store/requests.js";
import type {
  SessionRepository,
  TransportBindingRepository,
} from "../store/sessions.js";
import { nowIso } from "../time.js";
import type {
  NotifyResult,
  SessionRef,
  TransportAdapter,
  TransportBinding,
} from "../transport/adapter.js";
import type {
  BoundScope,
  Client,
  SessionRecord,
  TransportBindingRecord,
  TransportState,
} from "../types.js";

export type Session = SessionRecord;

export interface RegisterInput {
  displayName: string;
  client: Client;
  project: string;
  conversationId?: string | null;
  desiredAddress?: string;
}

export interface RegisterResult {
  session: Session;
  binding: TransportBindingRecord;
  bindDirective: string;
}

export interface ConfirmResult {
  session: Session;
  boundScope: BoundScope;
}

export type TransportClaimState =
  | "accepted"
  | "refused"
  | "unknown"
  | "not-attempted";

export interface ClaimResult {
  /** True only when a live binding was confirmed, not when the claim ran. */
  claimed: boolean;
  boundScope: BoundScope;
  /**
   * Outcome of the transport claim command. `unknown` means the command threw,
   * so it may still hold the role; callers must not retry the bind directive.
   */
  transportClaimState: TransportClaimState;
  bindingState: TransportState;
  session: Session;
  reason?: string;
  /** Non-fatal transport follow-ups, e.g. a Codex seat that was not recorded. */
  warnings?: string[];
}

export interface AttachInput {
  displayName?: string;
  client: Client;
  project: string;
  conversationId: string;
  hostSessionId: string;
}

export interface AttachResult {
  session: Session;
  binding: TransportBindingRecord;
  /** `existing` reuses the conversation's session; `registered` creates one. */
  attached: "existing" | "registered";
  claim: ClaimResult;
}

export type WhoamiInput = { sessionId: string } | { conversationId: string };

export type SessionListEntry = Session & {
  transport: TransportBindingRecord | null;
};

export interface SessionServiceDeps {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  transport: TransportAdapter;
  requests?: RequestRepository;
  db?: DatabaseSync;
  events?: EventRepository;
  now?: () => string;
  newId?: () => string;
}

function sessionRef(session: Session): SessionRef {
  return {
    sessionId: session.sessionId,
    displayName: session.displayName,
    client: session.client,
    project: session.project,
    conversationId: session.conversationId,
  };
}

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

function adapterBinding(record: TransportBindingRecord): TransportBinding {
  return {
    transport: record.transport,
    address: record.address,
    team: record.team,
    mode: record.mode,
    state: record.state,
    evidence: parseEvidence(record.evidenceJson),
    bindDirective: "",
  };
}

/**
 * Session registration and lookup. It owns identity, never transport details:
 * adapters provide the address/binding and the bind directive.
 */
export class SessionService {
  private readonly sessions: SessionRepository;
  private readonly bindings: TransportBindingRepository;
  private readonly transport: TransportAdapter;
  private readonly requests: RequestRepository | undefined;
  private readonly db: DatabaseSync | undefined;
  private readonly events: EventRepository | undefined;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: SessionServiceDeps) {
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.transport = deps.transport;
    this.requests = deps.requests;
    this.db = deps.db;
    this.events = deps.events;
    this.now = deps.now ?? nowIso;
    this.newId = deps.newId ?? newId;
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    validateDisplayName(input.displayName);
    validateClient(input.client);
    const at = this.now();
    const sessionId = this.newId();
    const ref: SessionRef = {
      sessionId,
      displayName: input.displayName,
      client: input.client,
      project: input.project,
      conversationId: input.conversationId ?? null,
    };

    // Register with the transport before persisting the session: an adapter
    // failure must not leave an unbound identity behind.
    const binding = await this.transport.register(ref, input.desiredAddress);
    const write = (): RegisterResult => {
      this.sessions.create({
        sessionId,
        displayName: input.displayName,
        client: input.client,
        project: input.project,
        conversationId: input.conversationId ?? null,
        lastSeenAt: at,
        createdAt: at,
      });
      const storedBinding = this.bindings.create({
        bindingId: this.newId(),
        sessionId,
        transport: binding.transport,
        address: binding.address,
        team: binding.team,
        mode: binding.mode,
        state: binding.state,
        evidenceJson: JSON.stringify(binding.evidence),
      });

      this.events?.record({
        event: "register",
        sessionId,
        transport: binding.transport,
        mode: binding.mode,
        ts: at,
        data: { address: binding.address },
      });
      return {
        session: this.sessions.get(sessionId) as Session,
        binding: storedBinding,
        bindDirective: binding.bindDirective,
      };
    };
    try {
      return this.db === undefined ? write() : withImmediate(this.db, write);
    } catch (error) {
      // The transport identity exists already; do not leave a half-created
      // session behind. Both compensation steps are best-effort, and release
      // must run even if marking the row left fails.
      try {
        this.sessions.markLeft(sessionId, at);
      } catch {
        // best effort
      }
      await this.transport.release(binding).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Try to turn a freshly registered binding into a live one from inside the
   * host conversation. The adapter receives the host session id; a transport
   * without that capability leaves the caller with the bind directive.
   */
  async claim(sessionId: string, hostSessionId: string): Promise<ClaimResult> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${sessionId}`,
      );
    }
    if (session.leftAt !== null) {
      throw new AechatError(
        "resume_unsafe",
        `session has left; create a new session: ${sessionId}`,
      );
    }
    const record = this.bindings.listForSession(sessionId).at(-1);
    if (record === undefined) {
      throw new AechatError(
        "transport_unavailable",
        `session has no transport binding: ${sessionId}`,
      );
    }
    if (this.transport.claim === undefined) {
      return {
        claimed: false,
        boundScope: "none",
        transportClaimState: "not-attempted",
        bindingState: record.state,
        session,
        reason: "transport does not support host-session claims",
      };
    }

    let result: NotifyResult;
    try {
      result = await this.transport.claim(
        sessionRef(session),
        adapterBinding(record),
        hostSessionId,
      );
    } catch (error) {
      // execFile can time out after actas-claim.sh already took the lock. The
      // outcome is genuinely unknown, so treat it as possibly held and keep
      // the caller away from a second actas attempt.
      const detail = error instanceof Error ? error.message : String(error);
      return {
        claimed: false,
        boundScope: "none",
        transportClaimState: "unknown",
        bindingState: this.currentBindingState(sessionId, record.state),
        session: this.currentSession(sessionId),
        reason:
          `transport claim outcome is unknown: ${detail}; it may already hold the role. ` +
          `Run aechat confirm --session ${sessionId}, or aechat leave --session ${sessionId} and register again. ` +
          "Do not run the bind directive.",
      };
    }
    if (!result.ok) {
      return {
        claimed: false,
        boundScope: "none",
        transportClaimState: "refused",
        bindingState: record.state,
        session,
        reason: result.error ?? "transport claim failed",
      };
    }

    const warning = result.warning;
    const warnings = warning === undefined ? undefined : [warning];
    if (warning !== undefined) {
      this.events?.record({
        event: "claim_warning",
        level: "warn",
        sessionId,
        transport: record.transport,
        errorDetail: warning,
      });
    }

    let confirmed: ConfirmResult;
    try {
      confirmed = await this.confirm(sessionId);
    } catch (error) {
      // The claim command succeeded, so the role may be held even though the
      // proof failed. Never tell the caller to run the bind directive here:
      // it would collide with this session's own lock. A later confirm can
      // still turn the claim into a live binding.
      const detail = error instanceof Error ? error.message : String(error);
      return {
        claimed: false,
        boundScope: "none",
        transportClaimState: "accepted",
        bindingState: this.currentBindingState(sessionId, record.state),
        session: this.currentSession(sessionId),
        reason:
          `transport accepted the claim but binding verification failed: ${detail}; ` +
          `run aechat confirm --session ${sessionId}, or aechat leave --session ${sessionId} and register again`,
        ...(warnings === undefined ? {} : { warnings }),
      };
    }

    const bindingState = this.currentBindingState(sessionId, record.state);
    if (confirmed.boundScope === "none" || bindingState !== "bound") {
      return {
        claimed: false,
        boundScope: "none",
        transportClaimState: "accepted",
        bindingState,
        session: confirmed.session,
        reason:
          `transport accepted the claim but no live binding was confirmed; ` +
          `run aechat confirm --session ${sessionId}, or aechat leave --session ${sessionId} and register again`,
        ...(warnings === undefined ? {} : { warnings }),
      };
    }
    return {
      claimed: true,
      boundScope: confirmed.boundScope,
      transportClaimState: "accepted",
      bindingState,
      session: confirmed.session,
      ...(warnings === undefined ? {} : { warnings }),
    };
  }

  /**
   * Reattach the conversation's existing session, or register one when the
   * conversation has no live session. Host start hooks call this so a restart
   * reuses the same session id and address instead of creating duplicates.
   */
  async attach(input: AttachInput): Promise<AttachResult> {
    const matches = this.sessions
      .findByConversationId(input.conversationId)
      .filter((session) => session.leftAt === null);
    if (matches.length > 1) {
      throw new AechatError(
        "ambiguous_target",
        `multiple live sessions for conversation: ${input.conversationId}`,
      );
    }
    if (matches.length === 1) {
      const session = matches[0] as Session;
      const binding = this.bindings.listForSession(session.sessionId).at(-1);
      if (binding === undefined) {
        throw new AechatError(
          "transport_unavailable",
          `session has no transport binding: ${session.sessionId}`,
        );
      }
      const claim = await this.claim(session.sessionId, input.hostSessionId);
      return {
        session: claim.session,
        binding,
        attached: "existing",
        claim,
      };
    }
    const registered = await this.register({
      displayName:
        input.displayName ??
        `${input.client}-${input.conversationId.slice(0, 8)}`,
      client: input.client,
      project: input.project,
      conversationId: input.conversationId,
    });
    const claim = await this.claim(
      registered.session.sessionId,
      input.hostSessionId,
    );
    return {
      session: claim.session,
      binding: registered.binding,
      attached: "registered",
      claim,
    };
  }

  private currentBindingState(
    sessionId: string,
    fallback: TransportState,
  ): TransportState {
    return this.bindings.listForSession(sessionId).at(-1)?.state ?? fallback;
  }

  private currentSession(sessionId: string): Session {
    return this.sessions.get(sessionId) as Session;
  }

  async confirm(sessionId: string): Promise<ConfirmResult> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${sessionId}`,
      );
    }
    if (session.leftAt !== null) {
      throw new AechatError(
        "resume_unsafe",
        `session has left; create a new session: ${sessionId}`,
      );
    }

    const records = this.bindings.listForSession(sessionId);
    const record = records.at(-1);
    if (record === undefined) {
      throw new AechatError(
        "transport_unavailable",
        `session has no transport binding: ${sessionId}`,
      );
    }

    const result = await this.transport.bind(
      sessionRef(session),
      adapterBinding(record),
      session.conversationId ?? undefined,
    );
    const current = this.sessions.get(sessionId);
    if (current?.leftAt !== null && current?.leftAt !== undefined) {
      await this.transport
        .release(adapterBinding(record))
        .catch(() => undefined);
      throw new AechatError(
        "resume_unsafe",
        `session left while confirming: ${sessionId}`,
      );
    }
    const at = this.now();
    const write = (): ConfirmResult => {
      this.bindings.updateState(record.bindingId, result.state, at);
      if (result.mode !== undefined && result.mode !== null) {
        this.bindings.updateMode(record.bindingId, result.mode);
      }

      const update: {
        sessionId: string;
        boundScope: BoundScope;
        boundAt?: string;
        boundCheckedAt: string;
        conversationId?: string;
      } = {
        sessionId,
        boundScope: result.boundScope,
        boundCheckedAt: at,
      };
      if (result.boundScope !== "none") {
        update.boundAt = at;
      }
      if (result.conversationId !== null) {
        update.conversationId = result.conversationId;
      }
      this.sessions.updateBinding(update);
      this.sessions.touch(sessionId, at);
      this.events?.record({
        event: "confirm",
        sessionId,
        transport: record.transport,
        mode: record.mode,
        ts: at,
        data: { boundScope: result.boundScope, bindingState: result.state },
      });

      return {
        session: this.sessions.get(sessionId) as Session,
        boundScope: result.boundScope,
      };
    };
    return this.db === undefined ? write() : withImmediate(this.db, write);
  }

  whoami(input: WhoamiInput): Session {
    if ("sessionId" in input && "conversationId" in input) {
      throw new AechatError(
        "invalid_input",
        "whoami accepts exactly one of --session or --conversation",
      );
    }
    if ("sessionId" in input) {
      const session = this.sessions.get(input.sessionId);
      if (session === undefined) {
        throw new AechatError(
          "session_not_found",
          `session not found: ${input.sessionId}`,
        );
      }
      this.sessions.touch(session.sessionId, this.now());
      return this.sessions.get(session.sessionId) as Session;
    }

    const matches = this.sessions.findByConversationId(input.conversationId);
    if (matches.length === 1) {
      const session = matches[0] as Session;
      this.sessions.touch(session.sessionId, this.now());
      return this.sessions.get(session.sessionId) as Session;
    }
    if (matches.length === 0) {
      throw new AechatError(
        "session_not_found",
        `no session for conversation: ${input.conversationId}`,
      );
    }
    throw new AechatError(
      "ambiguous_target",
      `multiple sessions for conversation: ${input.conversationId}`,
      { sessionIds: matches.map((session) => session.sessionId) },
    );
  }

  resolveTargetByName(displayName: string): Session {
    validateDisplayName(displayName);
    const matches = this.sessions
      .findByDisplayName(displayName)
      .filter((session) => session.leftAt === null);
    if (matches.length === 1) {
      return matches[0] as Session;
    }
    if (matches.length === 0) {
      throw new AechatError(
        "target_not_found",
        `no active session named: ${displayName}`,
      );
    }
    throw new AechatError(
      "ambiguous_target",
      `display name matches multiple sessions: ${displayName}`,
      {
        candidates: matches.map((session) => ({
          session_id: session.sessionId,
          display_name: session.displayName,
          client: session.client,
          project: session.project,
        })),
      },
    );
  }

  list(opts: { includeLeft?: boolean } = {}): SessionListEntry[] {
    return this.sessions.list(opts).map((session) => {
      const bindings = this.bindings.listForSession(session.sessionId);
      return {
        ...session,
        transport: bindings.at(-1) ?? null,
      };
    });
  }

  async leave(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${sessionId}`,
      );
    }
    if (session.leftAt !== null) {
      return;
    }
    const binding = this.bindings.listForSession(sessionId).at(-1);
    if (binding !== undefined) {
      try {
        await this.transport.release(adapterBinding(binding));
      } catch (error) {
        throw new AechatError(
          "transport_unavailable",
          `transport release failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const at = this.now();
    const write = (): void => {
      // A concurrent leave may have committed first; do not duplicate the
      // audit rows for a transition this call did not perform.
      if (!this.sessions.markLeft(sessionId, at)) {
        return;
      }
      if (binding !== undefined) {
        this.bindings.updateState(binding.bindingId, "released", at);
      }
      const cancelled = this.requests?.cancelForLeft(sessionId, at) ?? [];
      for (const request of cancelled) {
        this.events?.record({
          event: "cancel",
          sessionId,
          messageId: request.requestId,
          requestId: request.requestId,
          ts: at,
          data: {
            closeReason:
              request.requesterSession === sessionId
                ? "requester_left"
                : "target_left",
          },
        });
      }
      this.events?.record({
        event: "leave",
        sessionId,
        transport: binding?.transport ?? null,
        ts: at,
      });
    };
    if (this.db === undefined) {
      write();
    } else {
      withImmediate(this.db, write);
    }
  }

  heartbeat(sessionId: string, at: string = this.now()): void {
    if (this.sessions.get(sessionId) === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${sessionId}`,
      );
    }
    const write = (): void => {
      this.sessions.touch(sessionId, at, {
        host: true,
        hostSource: "heartbeat",
      });
      this.events?.record({
        event: "heartbeat",
        sessionId,
        ts: at,
        data: { at },
      });
    };
    if (this.db === undefined) {
      write();
    } else {
      withImmediate(this.db, write);
    }
  }
}
