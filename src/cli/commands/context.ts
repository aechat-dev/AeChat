import type { AppRuntime } from "../../app/runtime.js";

/**
 * The service subset a CLI command needs. This is a `Pick` of the single
 * composition root, not a second container, so a new service cannot drift
 * between the CLI and the app bridge.
 */
export type CommandContext = Pick<
  AppRuntime,
  | "service"
  | "delivery"
  | "request"
  | "resume"
  | "capabilities"
  | "audit"
  | "transport"
  | "now"
  | "sessionQuery"
  | "agmsgVersion"
>;
