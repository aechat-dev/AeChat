/**
 * Time helpers. All persisted timestamps are ISO 8601 UTC strings.
 */
export function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * True when `at` is non-null and at or before `now`.
 *
 * Callers use this for lazy expiry (`expires_at <= now`); an absent timestamp
 * never expires. Invalid timestamps are treated as not expired rather than
 * silently deleting data.
 */
export function isExpired(at: string | null, now: string = nowIso()): boolean {
  if (at === null) {
    return false;
  }
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  return Number.isFinite(atMs) && Number.isFinite(nowMs) && atMs <= nowMs;
}
