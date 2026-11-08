/**
 * Library entry point. The CLI lives at `src/cli/main.ts` (package bin).
 */

export * from "./contracts/envelope.js";
export * from "./contracts/ui.js";
export { AechatError } from "./core/errors.js";
export * from "./core/types.js";
export type { AppOptions } from "./runtime/options.js";
export type { ReadOnlyRuntime } from "./runtime/read-only-runtime.js";
export { createReadOnlyRuntime } from "./runtime/read-only-runtime.js";
export type { AppRuntime, AppServices } from "./runtime/runtime.js";
export { createRuntime } from "./runtime/runtime.js";
export { SessionQueryService } from "./runtime/session-query.js";
