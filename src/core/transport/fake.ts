import type { BoundScope, TransportState } from "../types.js";
import type {
  BindResult,
  CapabilityEvidence,
  NotifyResult,
  SessionRef,
  TransportAdapter,
  TransportBinding,
  TransportStatus,
} from "./adapter.js";

export type FakeBindMode = "conversation" | "host_role" | "none" | "fail";

export interface FakeTransportOptions {
  bindMode?: FakeBindMode;
  live?: boolean;
  registerFails?: boolean;
  notifyFails?: boolean;
  mode?: string;
  /** Delivery mode reported when bind is checked; null means unavailable. */
  boundMode?: string | null;
}

/**
 * Deterministic adapter for core tests. It never touches the filesystem or
 * the network; bind behavior is selected by options so registration tests can
 * exercise every bound_scope branch.
 */
export class FakeTransportAdapter implements TransportAdapter {
  readonly name = "fake";

  private readonly bindMode: FakeBindMode;
  private readonly live: boolean;
  private readonly registerFails: boolean;
  private readonly notifyFails: boolean;
  private readonly mode: string;
  private readonly boundMode: string | null;
  private addressCounter = 0;

  constructor(options: FakeTransportOptions = {}) {
    this.bindMode = options.bindMode ?? "host_role";
    this.live = options.live ?? true;
    this.registerFails = options.registerFails ?? false;
    this.notifyFails = options.notifyFails ?? false;
    this.mode = options.mode ?? "test";
    this.boundMode = options.boundMode ?? null;
  }

  register(
    session: SessionRef,
    desiredAddress?: string,
  ): Promise<TransportBinding> {
    if (this.registerFails) {
      return Promise.reject(new Error("fake register failure"));
    }
    const address =
      desiredAddress ??
      `aechat-${(this.addressCounter++).toString(16).padStart(12, "0")}`;
    return Promise.resolve({
      transport: this.name,
      address,
      team: "fake-team",
      mode: this.mode,
      state: "pending",
      evidence: {
        sessionId: session.sessionId,
        bindDirective: `fake actas ${address}`,
      },
      bindDirective: `fake actas ${address}`,
    });
  }

  bind(
    session: SessionRef,
    binding: TransportBinding,
    conversationId?: string,
  ): Promise<BindResult> {
    if (this.bindMode === "fail") {
      return Promise.resolve({
        state: "failed",
        boundScope: "none",
        conversationId: null,
        evidence: { reason: "fake bind failure" },
        reason: "fake bind failure",
      });
    }

    let boundScope: BoundScope;
    if (this.bindMode === "none") {
      boundScope = "none";
    } else if (
      this.bindMode === "conversation" &&
      conversationId !== undefined
    ) {
      boundScope = "conversation";
    } else {
      boundScope = "host_role";
    }

    const state: TransportState = boundScope === "none" ? "failed" : "bound";
    return Promise.resolve({
      state,
      boundScope,
      conversationId:
        boundScope === "conversation" ? (conversationId ?? null) : null,
      mode: this.boundMode,
      evidence: {
        sessionId: session.sessionId,
        address: binding.address,
        checked: true,
      },
    });
  }

  notify(): Promise<NotifyResult> {
    return Promise.resolve(
      this.notifyFails
        ? { ok: false, error: "fake notify failure" }
        : { ok: true },
    );
  }

  inspect(_binding?: TransportBinding): Promise<TransportStatus> {
    return Promise.resolve({
      state: this.live ? "live" : "dead",
      at: new Date().toISOString(),
      evidence: { fake: true },
    });
  }

  release(): Promise<void> {
    return Promise.resolve();
  }

  probe(): Promise<CapabilityEvidence> {
    return Promise.resolve({
      observedLevel: "unknown",
      pull: null,
      wait: null,
      notificationReceive: null,
      busyReceive: null,
      idleWakeup: null,
      evidence: { fake: true },
      at: new Date().toISOString(),
    });
  }
}
