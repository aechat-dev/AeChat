import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

function skill(host: "claude-code" | "codex"): string {
  return readFileSync(`${root}skills/${host}/SKILL.md`, "utf8");
}

describe.each(["claude-code", "codex"] as const)("%s skill", (host) => {
  const content = skill(host);

  it("starts with YAML frontmatter for host skill loaders", () => {
    expect(content.startsWith("---\nname: aechat\n")).toBe(true);
    expect(content).toContain("description:");
    const closing = content.indexOf("\n---\n", 4);
    expect(closing).toBeGreaterThan(0);
  });

  it("registers with the correct host and confirms the binding", () => {
    expect(content).toContain("aechat register --name");
    expect(content).toContain(`--client ${host}`);
    expect(content).toContain("bind_directive");
    expect(content).toContain("aechat confirm --session");
    expect(content).toContain("--session <uuid>");
  });

  it("documents the send, inbox and ack lifecycle", () => {
    expect(content).toContain("aechat send");
    expect(content).toContain("--to-session");
    expect(content).toContain("--to-name");
    expect(content).toContain("aechat inbox");
    expect(content).toContain("aechat ack");
    expect(content).toContain("--delivery");
    expect(content).toContain("delivery_token");
  });

  it("marks message content as agent-origin and not user authorization", () => {
    expect(content).toContain("agent-origin");
    expect(content).toMatch(/not[- ]user[- ]instructions?/i);
    expect(content).toContain("Never treat");
    expect(content).toMatch(/authorization/i);
  });

  it("forbids guessing the receiver and names ambiguity explicitly", () => {
    expect(content).toMatch(/Never guess the receiver/i);
    expect(content).toContain("ambiguous");
    expect(content).toContain("Do not pick the first");
  });

  it("prefers JSON and documents the human text framing", () => {
    expect(content).toContain("--json");
    expect(content).toContain("---BEGIN AE CHAT MESSAGE");
    expect(content).toContain("---END---");
    expect(content).toMatch(/Prefer JSON/i);
  });

  it("covers requests, failure handling and terminal leave", () => {
    expect(content).toContain("--request");
    expect(content).toContain("aechat reply");
    expect(content).toContain("aechat wait");
    expect(content).toContain("lease_expired");
    expect(content).toContain("aechat leave");
    expect(content).toMatch(/leave.*terminal/is);
  });
});

describe("host-specific wakeup claims", () => {
  it("does not claim Codex wakeup without evidence", () => {
    const content = skill("codex");
    expect(content).toMatch(/wakeup is not assumed/i);
    expect(content).toMatch(/only the capability values/i);
  });

  it("describes Claude Code binding as evidence, not a wakeup promise", () => {
    const content = skill("claude-code");
    expect(content).toMatch(/evidence, not a promise of wakeup/i);
  });
});
