import type { DatabaseSync } from "node:sqlite";

import { EventRepository } from "../core/store/events.js";
import {
  DeliveryRepository,
  MessageRepository,
} from "../core/store/messages.js";
import { ProbeRepository } from "../core/store/probes.js";
import { RequestRepository } from "../core/store/requests.js";
import {
  SessionRepository,
  TransportBindingRepository,
} from "../core/store/sessions.js";

/** Repository set shared by the writable and read-only composition roots. */
export interface AppRepositories {
  sessions: SessionRepository;
  bindings: TransportBindingRepository;
  messages: MessageRepository;
  deliveries: DeliveryRepository;
  requests: RequestRepository;
  probes: ProbeRepository;
  events: EventRepository;
}

export function createRepositories(db: DatabaseSync): AppRepositories {
  return {
    sessions: new SessionRepository(db),
    bindings: new TransportBindingRepository(db),
    messages: new MessageRepository(db),
    deliveries: new DeliveryRepository(db),
    requests: new RequestRepository(db),
    probes: new ProbeRepository(db),
    events: new EventRepository(db),
  };
}
