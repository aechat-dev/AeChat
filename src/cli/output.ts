import { AechatError, exitCodeFor, type ErrorCode } from "../core/errors.js";

export const SCHEMA_VERSION = 1;

/**
 * Write a success envelope to stdout. `meta.schema` is always set by the
 * envelope, never by caller-supplied metadata.
 */
export function ok(data: unknown, meta: Record<string, unknown> = {}): void {
  const envelope = {
    ok: true,
    data,
    meta: { ...meta, schema: SCHEMA_VERSION },
  };
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
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
  const error =
    details === undefined ? { code, message } : { code, message, details };
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error,
      meta: { schema: SCHEMA_VERSION },
    })}\n`,
  );
}

/**
 * Write a failure envelope, record the exit code, and throw the typed error.
 * Throwing keeps `fail` usable from any layer and `never`-typed.
 */
export function fail(code: ErrorCode, message: string, details?: unknown): never {
  errorEnvelope(code, message, details);
  throw new AechatError(code, message, details);
}
