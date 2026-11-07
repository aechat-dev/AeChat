import type { CapabilityService } from "../../core/services/capability-service.js";
import type { DeliveryService } from "../../core/services/delivery-service.js";
import type { RequestService } from "../../core/services/request-service.js";
import type { ResumeService } from "../../core/services/resume-service.js";
import type { SessionService } from "../../core/services/session-service.js";
import type { TransportAdapter } from "../../core/transport/adapter.js";

export interface CommandContext {
  service: SessionService;
  delivery: DeliveryService;
  request: RequestService;
  resume: ResumeService;
  capabilities: CapabilityService;
  transport: TransportAdapter;
  now: () => string;
  agmsgVersion?: () => Promise<string>;
}
