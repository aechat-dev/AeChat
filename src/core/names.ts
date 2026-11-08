import { AechatError } from "./errors.js";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_SHAPE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isValidClient(client: string): boolean {
  return CLIENT_SHAPE.test(client);
}

/** Host ids are adapter-owned, but their shape is a core invariant. */
export function validateClient(client: string): void {
  if (!isValidClient(client)) {
    throw new AechatError(
      "invalid_name",
      "host id must be 1-32 lowercase letters, digits or dashes",
    );
  }
}

/**
 * Display names are user-facing and non-unique, but must be printable, 1–64
 * characters, and never look like an internal UUID or the reserved marker.
 */
export function validateDisplayName(name: string): void {
  if (name.length < 1 || name.length > 64) {
    throw new AechatError(
      "invalid_name",
      "display name must contain 1-64 characters",
    );
  }
  if (/\p{C}/u.test(name)) {
    throw new AechatError(
      "invalid_name",
      "display name must not contain control characters",
    );
  }
  if (UUID_SHAPE.test(name)) {
    throw new AechatError(
      "invalid_name",
      "display name must not have UUID shape",
    );
  }
  if (name.includes("[AeChat]")) {
    throw new AechatError(
      "invalid_name",
      "display name must not contain the reserved [AeChat] marker",
    );
  }
}
