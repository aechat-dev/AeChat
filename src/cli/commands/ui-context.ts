import type { ReadOnlyRuntime } from "../../app/read-only-runtime.js";
import type { UiQueryService } from "../../app/ui-query-service.js";

/** Composition needed by the read-only `ui-*` bridge commands. */
export interface UiCommandContext {
  runtime: ReadOnlyRuntime;
  ui: UiQueryService;
}
