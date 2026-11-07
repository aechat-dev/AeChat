import { AechatError, exitCodeFor, type ErrorCode } from "../core/errors.js";
import {
  buildErrorEnvelope,
  buildSuccessEnvelope,
  SCHEMA_VERSION,
} from "../contracts/envelope.js";

export { SCHEMA_VERSION };

export interface CommandResult {
  data: unknown;
  text?: string;
  exitCode?: number;
}

export function isCommandResult(value: unknown): value is CommandResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    !("ok" in value)
  );
}

/**
 * Render a command result: text for human-facing message commands, the JSON
 * envelope everywhere else.
 */
export function render(result: unknown): void {
  if (isCommandResult(result) && result.text !== undefined) {
    process.stdout.write(result.text);
    return;
  }
  ok(isCommandResult(result) ? result.data : result);
}

/**
 * Write a success envelope to stdout. `meta.schema` is always set by the
 * envelope, never by caller-supplied metadata.
 */
export function ok(data: unknown, meta: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify(buildSuccessEnvelope(data, meta))}\n`);
}

/**
 * Write a failure envelope to stderr and record the exit code without
 * throwing. The CLI boundary uses this when it catches an `AechatError`.
 */
export function errorEnvelope(
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  process.exitCode = exitCodeFor(code);
  process.stderr.write(`${JSON.stringify(buildErrorEnvelope(code, message, details))}\n`);
}

/**
 * Write a failure envelope, record the exit code, and throw the typed error.
 * Throwing keeps `fail` usable from any layer and `never`-typed.
 */
export function fail(code: ErrorCode, message: string, details?: unknown): never {
  errorEnvelope(code, message, details);
  throw new AechatError(code, message, details);
}
