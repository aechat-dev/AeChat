import type { DatabaseSync } from "node:sqlite";

import { AechatError } from "../errors.js";
import { withImmediate } from "../store/db.js";
import type { EventRepository } from "../store/events.js";
import type { DeliveryRepository } from "../store/messages.js";
import type {
  SessionRepository,
  TransportBindingRepository,
} from "../store/sessions.js";
import { nowIso } from "../time.js";
import type {
  BindResult,
  SessionRef,
  TransportAdapter,
  TransportStatus,
} from "../transport/adapter.js";
import type { SessionRecord, TransportBindingRecord } from "../types.js";
import { adapterBinding } from "./capability-service.js";
import { DEFAULT_TTL, deriveStatus } from "./session-status.js";

export interface ResumeBeginInput {
  sessionId: string;
  force?: boolean;
}

export interface ResumeBeginResult {
  session: SessionRecord;
  binding: TransportBindingRecord;
  bindDirective: string;
  forced: boolean;
}

export interface ResumeServiceDeps {
  db: DatabaseSync;
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  deliveries: DeliveryRepository;
  transport: TransportAdapter;
  events?: EventRepository;
  now?: () => string;
}

function sessionRef(session: SessionRecord): SessionRef {
  return {
    sessionId: session.sessionId,
    displayName: session.displayName,
    client: session.client,
    project: session.project,
    conversationId: session.conversationId,
  };
}

function parseBindDirective(json: string | null): string {
  if (json === null) {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return "";
    }
    const directive = (parsed as Record<string, unknown>)["bindDirective"];
    return typeof directive === "string" ? directive : "";
  } catch {
    return "";
  }
}

function inspectionAllowsResume(
  status: TransportStatus,
  session: SessionRecord,
  force: boolean,
): { allowed: boolean; forced: boolean; reason?: string } {
  if (status.state === "live") {
    return {
      allowed: false,
      forced: false,
      reason: "old host transport is still live",
    };
  }
  if (status.state === "dead" || status.state === "released") {
    return { allowed: true, forced: false };
  }
  // unknown: no host-neutral proof of death exists, so --force is the only
  // explicit path for every adapter.
  if (!force) {
    return {
      allowed: false,
      forced: false,
      reason: "cannot prove the old binding is dead; use --force",
    };
  }
  return { allowed: true, forced: true };
}

/**
 * Explicit, two-phase resume. Begin only marks resume_pending; the old binding
 * is never released until the new host has successfully bound.
 */
export class ResumeService {
  private readonly db: DatabaseSync;
  private readonly sessions: SessionRepository;
  private readonly bindings: TransportBindingRepository;
  private readonly deliveries: DeliveryRepository;
  private readonly transport: TransportAdapter;
  private readonly events: EventRepository | undefined;
  private readonly now: () => string;

  constructor(deps: ResumeServiceDeps) {
    this.db = deps.db;
    this.sessions = deps.sessions;
    this.bindings = deps.bindings;
    this.deliveries = deps.deliveries;
    this.transport = deps.transport;
    this.events = deps.events;
    this.now = deps.now ?? nowIso;
  }

  async begin(input: ResumeBeginInput): Promise<ResumeBeginResult> {
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${input.sessionId}`,
      );
    }
    if (session.leftAt !== null) {
      throw new AechatError(
        "resume_unsafe",
        `session has left: ${input.sessionId}`,
      );
    }
    if (session.resumeState !== "idle") {
      throw new AechatError(
        "resume_conflict",
        `session resume is already pending: ${input.sessionId}`,
      );
    }
    const binding = this.bindings.listForSession(input.sessionId).at(-1);
    if (binding === undefined) {
      throw new AechatError(
        "resume_unsafe",
        `session has no transport binding: ${input.sessionId}`,
      );
    }

    const inspected = await this.transport.inspect(adapterBinding(binding));
    const status = deriveStatus({
      lastSeenAt: session.lastSeenAt,
      hostSeenAt: session.hostSeenAt,
      hostSeenSource: session.hostSeenSource,
      binding: { state: inspected.state, at: inspected.at ?? null },
      leftAt: session.leftAt,
      now: this.now(),
      ttl: DEFAULT_TTL,
    });
    if (status.status === "online") {
      throw new AechatError(
        "resume_unsafe",
        "session is still online; resume requires an offline or unknown old host",
      );
    }
    const decision = inspectionAllowsResume(
      inspected,
      session,
      input.force === true,
    );
    if (!decision.allowed) {
      throw new AechatError(
        "resume_unsafe",
        decision.reason ?? "resume unsafe",
      );
    }
    if (!this.sessions.beginResume(input.sessionId)) {
      const latest = this.sessions.get(input.sessionId);
      if (latest?.leftAt !== null && latest?.leftAt !== undefined) {
        throw new AechatError(
          "resume_unsafe",
          `session has left: ${input.sessionId}`,
        );
      }
      throw new AechatError(
        "resume_conflict",
        `session resume is already pending: ${input.sessionId}`,
      );
    }

    this.events?.record({
      event: decision.forced ? "resume_forced" : "resume",
      sessionId: input.sessionId,
      transport: binding.transport,
      data: { transportState: inspected.state, forced: decision.forced },
    });
    return {
      session: this.sessions.get(input.sessionId) as SessionRecord,
      binding,
      bindDirective: parseBindDirective(binding.evidenceJson),
      forced: decision.forced,
    };
  }

  async confirm(sessionId: string): Promise<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new AechatError(
        "session_not_found",
        `session not found: ${sessionId}`,
      );
    }
    if (session.leftAt !== null) {
      throw new AechatError("resume_unsafe", `session has left: ${sessionId}`);
    }
    if (session.resumeState !== "resume_pending") {
      throw new AechatError(
        "resume_conflict",
        `session has no pending resume: ${sessionId}`,
      );
    }
    const binding = this.bindings.listForSession(sessionId).at(-1);
    if (binding === undefined) {
      this.sessions.failResume(sessionId);
      throw new AechatError(
        "resume_unsafe",
        `session has no transport binding: ${sessionId}`,
      );
    }

    let result: BindResult;
    try {
      result = await this.transport.bind(
        sessionRef(session),
        adapterBinding(binding),
        session.conversationId ?? undefined,
      );
    } catch (error) {
      this.sessions.failResume(sessionId);
      this.events?.record({
        event: "resume_failed",
        level: "warn",
        sessionId,
        transport: binding.transport,
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    const at = this.now();
    const current = this.sessions.get(sessionId);
    if (current?.leftAt !== null && current?.leftAt !== undefined) {
      await this.transport
        .release(adapterBinding(binding))
        .catch(() => undefined);
      this.sessions.failResume(sessionId);
      throw new AechatError("resume_unsafe", `session has left: ${sessionId}`);
    }
    if (result.state !== "bound" || result.boundScope === "none") {
      this.sessions.failResume(sessionId);
      this.events?.record({
        event: "resume_failed",
        level: "warn",
        sessionId,
        transport: binding.transport,
        errorDetail: result.reason ?? "transport did not establish a binding",
      });
      throw new AechatError(
        "resume_unsafe",
        result.reason ?? "transport did not establish a binding",
      );
    }

    try {
      withImmediate(this.db, () => {
        this.bindings.updateState(binding.bindingId, result.state, at);
        this.sessions.updateBinding({
          sessionId,
          boundScope: result.boundScope,
          boundAt: at,
          boundCheckedAt: at,
          ...(result.conversationId === null
            ? {}
            : { conversationId: result.conversationId }),
        });
        if (!this.sessions.finishResume(sessionId, at)) {
          const latest = this.sessions.get(sessionId);
          if (latest?.leftAt !== null && latest?.leftAt !== undefined) {
            throw new AechatError(
              "resume_unsafe",
              `session has left: ${sessionId}`,
            );
          }
          throw new AechatError(
            "resume_conflict",
            `session resume state changed: ${sessionId}`,
          );
        }
        this.deliveries.resetUnackedForResume(sessionId);
      });
    } catch (error) {
      this.sessions.failResume(sessionId);
      this.events?.record({
        event: "resume_failed",
        level: "warn",
        sessionId,
        transport: binding.transport,
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    this.events?.record({
      event: "resume_complete",
      sessionId,
      transport: binding.transport,
      data: { boundScope: result.boundScope, forced: false },
    });
    return this.sessions.get(sessionId) as SessionRecord;
  }
}
