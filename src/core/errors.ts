/**
 * Stable error codes and their process exit codes.
 *
 * Exit code contract (spec §12):
 *   0 success; 2 timeout/expected negative; 3 not found; 4 conflict/ambiguity;
 *   5 not allowed; 6 invalid input; 1 internal error.
 */
export type ErrorCode =
  | "session_not_found"
  | "target_not_found"
  | "ambiguous_target"
  | "not_actor"
  | "request_closed"
  | "already_replied"
  | "delivery_not_found"
  | "lease_expired"
  | "not_delivered"
  | "transport_unavailable"
  | "notify_failed"
  | "resume_conflict"
  | "resume_unsafe"
  | "target_left"
  | "invalid_body"
  | "invalid_name"
  | "invalid_input"
  | "internal";

const EXIT_CODES: Record<ErrorCode, number> = {
  session_not_found: 3,
  target_not_found: 3,
  ambiguous_target: 4,
  not_actor: 5,
  request_closed: 4,
  already_replied: 4,
  delivery_not_found: 3,
  lease_expired: 4,
  not_delivered: 4,
  transport_unavailable: 1,
  notify_failed: 1,
  resume_conflict: 4,
  resume_unsafe: 5,
  target_left: 5,
  invalid_body: 6,
  invalid_name: 6,
  invalid_input: 6,
  internal: 1,
};

export function exitCodeFor(code: ErrorCode): number {
  return EXIT_CODES[code];
}

/**
 * Typed failure carried from the core/CLI layer to the process boundary.
 *
 * The CLI writes the JSON envelope before throwing this error; the process
 * boundary uses `exitCode` to set `process.exitCode`. Core code can also throw
 * it directly, in which case the CLI catches it and emits the envelope.
 */
export class AechatError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AechatError";
    this.code = code;
    this.exitCode = exitCodeFor(code);
    this.details = details;
  }
}
