import { homedir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_ERROR_DETAIL_BYTES,
  redactErrorDetail,
} from "../../src/core/log-redaction.js";
import { openDatabase } from "../../src/core/store/db.js";
import { EventRepository } from "../../src/core/store/events.js";
import { migrate } from "../../src/core/store/schema.js";

const databases: Array<{ close(): void }> = [];

afterEach(() => {
  while (databases.length > 0) {
    databases.pop()?.close();
  }
});

describe("redactErrorDetail", () => {
  it("redacts tokens, home paths and foreign user homes", () => {
    const home = homedir();
    const text = redactErrorDetail(
      `token=super-secret password=hunter2 Authorization: Basic basic-secret /Users/alice/project ${home}/.aechat/aechat.db`,
    );

    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("basic-secret");
    expect(text).not.toContain("/Users/alice");
    expect(text).not.toContain(home);
    expect(text).toContain("[REDACTED]");
  });

  it.each([
    ["Basic", "Authorization: Basic basic-secret", "basic-secret"],
    ["Bearer", "Authorization: Bearer bearer-secret", "bearer-secret"],
    [
      "Digest",
      'Authorization: Digest username="u", realm="r", response="digest-secret"',
      "digest-secret",
    ],
    [
      "AWS4",
      "Authorization: AWS4-HMAC-SHA256 Credential=AKIA/20261107, Signature=sig-secret",
      "sig-secret",
    ],
    ["ApiKey", "Authorization: ApiKey api-secret", "api-secret"],
  ])("redacts the whole %s authorization value", (_scheme, header, secret) => {
    const text = redactErrorDetail(`${header} /tmp/project`) as string;

    expect(text).not.toContain(secret);
    expect(text).not.toContain("AKIA");
    expect(text).toBe("Authorization: [REDACTED]");
  });

  it("redacts common absolute path roots", () => {
    const text = redactErrorDetail(
      "failed at /private/tmp/x /var/folders/y /opt/homebrew/bin",
    ) as string;

    expect(text).not.toContain("/private/tmp");
    expect(text).not.toContain("/var/folders");
    expect(text).not.toContain("/opt/homebrew");
    expect(text).toContain("[path]");
  });

  it("truncates to 2 KiB after redaction", () => {    const text = redactErrorDetail(
      `token=super-secret ${"x".repeat(5000)} hidden-tail`,
    ) as string;

    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      MAX_ERROR_DETAIL_BYTES,
    );
    expect(text.endsWith("hidden-tail")).toBe(false);
    expect(text).not.toContain("super-secret");
  });

  it("redacts old rows again when read", () => {
    const db = openDatabase(":memory:");
    databases.push(db);
    migrate(db);
    const events = new EventRepository(db);
    const home = homedir();
    db.prepare(
      `INSERT INTO events (event_id, ts, level, event, session_id, error_detail)
       VALUES ('legacy', '2026-11-07T00:00:00.000Z', 'info', 'notify_fail', 's', ?)`,
    ).run(`token=legacy-secret ${home}/private ${"y".repeat(3000)}`);

    const stored = events.listForSession("s")[0];
    expect(stored?.errorDetail).not.toContain("legacy-secret");
    expect(stored?.errorDetail).not.toContain(home);
    expect(
      Buffer.byteLength(stored?.errorDetail ?? "", "utf8"),
    ).toBeLessThanOrEqual(MAX_ERROR_DETAIL_BYTES);
  });
});
