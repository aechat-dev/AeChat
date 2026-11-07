import { homedir } from "node:os";

export const MAX_ERROR_DETAIL_BYTES = 2048;

const TOKEN_PATTERNS: RegExp[] = [
  /\bAuthorization\s*[=:]\s*[^\r\n]*/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]+/gi,
  /((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)([^\s,;]+)/gi,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
];

function redactPaths(text: string): string {
  const home = homedir();
  let redacted = home === "" ? text : text.replaceAll(home, "~");
  redacted = redacted.replace(/\$HOME\b/g, "~");
  // Do not leak another user's home path when the error came from a
  // subprocess with a different HOME.
  redacted = redacted.replace(
    /\/(?:Users|home|private|tmp|var|opt|etc|Volumes|Library|usr|bin|sbin|run|mnt)\/[^\s"'`]*/g,
    "[path]",
  );
  return redacted;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * Audit details are untrusted subprocess output. Redact before persisting and
 * again on read, so rows written by older versions cannot leak on display.
 */
export function redactErrorDetail(
  value: string | null,
  maxBytes = MAX_ERROR_DETAIL_BYTES,
): string | null {
  if (value === null) {
    return null;
  }
  let redacted = redactPaths(value);
  for (const pattern of TOKEN_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix?: string) => {
      if (/^authorization\b/i.test(match)) {
        return "Authorization: [REDACTED]";
      }
      if (typeof prefix === "string") {
        return `${prefix}[REDACTED]`;
      }
      return match.toLowerCase().startsWith("bearer ")
        ? "Bearer [REDACTED]"
        : "[REDACTED]";
    });
  }
  return truncateUtf8(redacted, maxBytes);
}
