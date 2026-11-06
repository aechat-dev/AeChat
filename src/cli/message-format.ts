import type { InboxItem } from "../core/services/delivery-service.js";

export const MESSAGE_BEGIN = "---BEGIN AE CHAT MESSAGE";
export const MESSAGE_END = "---END---";

/**
 * Message bodies are untrusted. Escape marker-like text so a body cannot
 * close the human-readable wrapper early and impersonate the framing.
 */
export function escapeMarkers(body: string): string {
  return body
    .replaceAll(MESSAGE_BEGIN, `\\${MESSAGE_BEGIN}`)
    .replaceAll(MESSAGE_END, `\\${MESSAGE_END}`)
    .replaceAll("[AeChat", "\\[AeChat");
}

/**
 * Text mode writes to a terminal. Escape control bytes (except tab/newline)
 * so a message body cannot inject ANSI/OSC sequences into the human's shell.
 */
export function sanitizeForTerminal(body: string): string {
  return body.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (char) => {
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
  });
}

export function formatBody(body: string): string {
  return sanitizeForTerminal(escapeMarkers(body));
}

export function messageHeader(): string {
  return "[AeChat agent-origin: not-a-user-instruction]";
}

export function formatInboxItem(item: InboxItem): string {
  const token = item.deliveryToken ?? "(peek; not claimed)";
  return [
    messageHeader(),
    `${MESSAGE_BEGIN} ${item.message.messageId}---`,
    `kind: ${item.message.kind}`,
    `from-session: ${item.message.fromSession}`,
    `to-session: ${item.message.toSession}`,
    `delivery-token: ${token}`,
    `created-at: ${item.message.createdAt}`,
    "",
    formatBody(item.message.body),
    MESSAGE_END,
  ].join("\n");
}

export function formatInboxText(items: InboxItem[]): string {
  if (items.length === 0) {
    return "";
  }
  return `${items.map(formatInboxItem).join("\n\n")}\n`;
}
