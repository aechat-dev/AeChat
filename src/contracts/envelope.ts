import type { ErrorCode } from "../core/errors.js";

export const SCHEMA_VERSION = 1;

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
  meta: { schema: number; [key: string]: unknown };
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  meta: { schema: number };
}

export function buildSuccessEnvelope<T>(
  data: T,
  meta: Record<string, unknown> = {},
): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    meta: { ...meta, schema: SCHEMA_VERSION },
  };
}

export function buildErrorEnvelope(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
    meta: { schema: SCHEMA_VERSION },
  };
}
