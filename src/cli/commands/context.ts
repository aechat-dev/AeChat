import type { SessionService } from "../../core/services/session-service.js";
import type { TransportAdapter } from "../../core/transport/adapter.js";

export interface CommandContext {
  service: SessionService;
  transport: TransportAdapter;
  now: () => string;
}
