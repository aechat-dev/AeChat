import { AechatError } from "../errors.js";
import { newId } from "../ids.js";
import { validateDisplayName } from "../names.js";
import { nowIso } from "../time.js";
import type { BoundScope, Client, SessionRecord } from "../types.js";
import type {
  SessionRef,
  TransportAdapter,
  TransportBinding,
} from "../transport/adapter.js";
import type {
  SessionRepository,
  TransportBindingRepository,
} from "../store/sessions.js";
import type { EventRepository } from "../store/events.js";
import type { TransportBindingRecord } from "../types.js";

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

export type WhoamiInput =
  | { sessionId: string }
  | { conversationId: string };

export type SessionListEntry = Session & {
  transport: TransportBindingRecord | null;
};

export interface SessionServiceDeps {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  transport: TransportAdapter;
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
  private readonly events: EventRepository | undefined;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: SessionServiceDeps) {
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.transport = deps.transport;
    this.events = deps.events;
    this.now = deps.now ?? nowIso;
    this.newId = deps.newId ?? newId;
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    validateDisplayName(input.displayName);
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
    try {
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
        data: { address: binding.address },
      });
      return {
        session: this.sessions.get(sessionId) as Session,
        binding: storedBinding,
        bindDirective: binding.bindDirective,
      };
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

  async confirm(sessionId: string): Promise<ConfirmResult> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError("session_not_found", `session not found: ${sessionId}`);
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
    const at = this.now();
    this.bindings.updateState(record.bindingId, result.state, at);

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
      data: { boundScope: result.boundScope, bindingState: result.state },
    });

    return {
      session: this.sessions.get(sessionId) as Session,
      boundScope: result.boundScope,
    };
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

  list(opts: { includeLeft?: boolean } = {}): SessionListEntry[] {
    return this.sessions.list(opts).map((session) => {
      const bindings = this.bindings.listForSession(session.sessionId);
      return {
        ...session,
        transport: bindings.at(-1) ?? null,
      };
    });
  }

  heartbeat(sessionId: string, at: string = this.now()): void {
    if (this.sessions.get(sessionId) === undefined) {
      throw new AechatError("session_not_found", `session not found: ${sessionId}`);
    }
    this.sessions.touch(sessionId, at, { host: true });
    this.events?.record({ event: "heartbeat", sessionId, data: { at } });
  }
}
