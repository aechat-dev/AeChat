/**
 * Library entry point. The CLI lives at `src/cli/main.ts` (package bin).
 */
export { createRuntime } from "./app/runtime.js";
export type { AppRuntime, AppServices } from "./app/runtime.js";
export { createReadOnlyRuntime } from "./app/read-only-runtime.js";
export type { ReadOnlyRuntime } from "./app/read-only-runtime.js";
export type { AppOptions } from "./app/options.js";
export { SessionQueryService } from "./app/session-query.js";
export * from "./contracts/envelope.js";
export * from "./contracts/ui.js";
export * from "./core/types.js";
export { AechatError } from "./core/errors.js";
