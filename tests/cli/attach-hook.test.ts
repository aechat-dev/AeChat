import { describe, expect, it } from "vitest";

import { attachCommand } from "../../src/cli/commands/setup.js";

describe("codex attach hook command", () => {
  it("invokes the CLI entry point, not the setup module", () => {
    const command = attachCommand("/tmp/project");

    expect(command).toContain("/cli/main.js");
    expect(command).not.toContain("commands/setup.js");
    expect(command).toContain(" attach ");
    expect(command).toContain("--client codex");
    expect(command).toContain("--project '/tmp/project'");
    expect(command).toContain("--stdin-session");
  });
});
