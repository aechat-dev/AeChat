import type { ReadOnlyRuntime } from "../../runtime/read-only-runtime.js";
import type { UiQueryService } from "../../runtime/ui-query-service.js";

/** Composition needed by the read-only `ui-*` bridge commands. */
export interface UiCommandContext {
  runtime: ReadOnlyRuntime;
  ui: UiQueryService;
}
