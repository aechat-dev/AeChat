import type { DeliveryService } from "../../core/services/delivery-service.js";
import type { RequestService } from "../../core/services/request-service.js";
import type { SessionService } from "../../core/services/session-service.js";
import type { TransportAdapter } from "../../core/transport/adapter.js";

export interface CommandContext {
  service: SessionService;
  delivery: DeliveryService;
  request: RequestService;
  transport: TransportAdapter;
  now: () => string;
}
