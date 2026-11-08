import { describe, expect, it, vi } from "vitest";
import { AgmsgAdapter } from "../../../src/adapters/transport/agmsg/agmsg-adapter.js";
import {
  AgmsgCli,
  type AgmsgCliPort,
  type CommandRunner,
} from "../../../src/adapters/transport/agmsg/agmsg-cli.js";
import type { SessionRef } from "../../../src/core/transport/adapter.js";

const SESSION: SessionRef = {
  sessionId: "session-1",
  displayName: "dev",
  client: "claude-code",
  project: "/tmp/project",
  conversationId: null,
};

function fakeCli(overrides: Partial<AgmsgCliPort> = {}): AgmsgCliPort {
  return {
    version: vi.fn(async () => "1.7.1"),
    join: vi.fn(async () => ({ ok: true, stderr: "" })),
    claim: vi.fn(async () => ({ ok: true, stderr: "" })),
    notify: vi.fn(async () => ({ ok: true, stderr: "" })),
    teamJson: vi.fn(async () => ({ agents: {} })),
    deliveryStatus: vi.fn(async () => ({ mode: "monitor" })),
    doctorStatus: vi.fn(async () => ({ mode: "monitor", locks: {} })),
    leave: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("AgmsgCli", () => {
  it("accepts a bare semver from version.sh", async () => {
    const runner: CommandRunner = async () => ({
      stdout: "1.7.1\n",
      stderr: "",
      exitCode: 0,
    });
    const cli = new AgmsgCli({ scriptsDir: "/scripts", runner });
    await expect(cli.version()).resolves.toBe("1.7.1");
  });

  it("rejects an unsupported agmsg version", async () => {
    const runner: CommandRunner = async () => ({
      stdout: "agmsg 1.6.0 (install: /tmp)\n",
      stderr: "",
      exitCode: 0,
    });
    const cli = new AgmsgCli({ scriptsDir: "/scripts", runner });

    await expect(cli.version()).rejects.toMatchObject({
      code: "transport_unavailable",
    });
  });

  it("notify uses execFile argv and never a shell string", async () => {
    const runner = vi.fn<CommandRunner>(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
    }));
    const cli = new AgmsgCli({ scriptsDir: "/scripts", runner });

    const text = "hello; rm -rf / $(touch /tmp/pwned)";
    const result = await cli.notify({ team: "t", from: "a", to: "b", text });

    expect(result).toEqual({ ok: true, stderr: "" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "/scripts/send.sh",
      ["t", "a", "b", text],
      expect.anything(),
    );
  });

  it("notify failure returns ok=false with stderr", async () => {
    const runner: CommandRunner = async () => ({
      stdout: "",
      stderr: "Error: not registered\n",
      exitCode: 1,
    });
    const cli = new AgmsgCli({ scriptsDir: "/scripts", runner });

    await expect(
      cli.notify({ team: "t", from: "a", to: "b", text: "hello" }),
    ).resolves.toEqual({ ok: false, stderr: "Error: not registered" });
  });
});

describe("AgmsgAdapter", () => {
  it("register maps session to aechat-<12 hex> address", async () => {
    const cli = fakeCli();
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });

    const binding = await adapter.register(SESSION);

    expect(binding.address).toMatch(/^aechat-[0-9a-f]{12}$/);
    expect(binding.transport).toBe("agmsg");
    expect(binding.bindDirective).toContain(binding.address);
    expect(cli.version).toHaveBeenCalled();
    expect(cli.join).toHaveBeenCalledWith({
      team: "aechat-test",
      address: binding.address,
      client: "claude-code",
      project: "/tmp/project",
    });
  });

  it("inspect reports live only with a live actas lock", async () => {
    const address = "aechat-aaaaaaaaaaaa";
    const cli = fakeCli({
      teamJson: vi.fn(async () => ({
        agents: { [address]: { member_id: "m-1", registrations: [] } },
      })),
      doctorStatus: vi.fn(async () => ({
        mode: "monitor",
        locks: {
          [`aechat-test/${address}`]:
            "owner(alive)=sid.123 cc-instance=present watcher=running",
        },
      })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, address);

    await expect(adapter.inspect(binding)).resolves.toMatchObject({
      state: "live",
    });
  });

  it("inspect keeps roster-only bindings unknown, not live", async () => {
    const address = "aechat-aaaaaaaaaaaa";
    const cli = fakeCli({
      teamJson: vi.fn(async () => ({
        agents: { [address]: { member_id: "m-1", registrations: [] } },
      })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, address);

    await expect(adapter.inspect(binding)).resolves.toMatchObject({
      state: "unknown",
    });
  });

  it("bind reports host_role only with a live lock", async () => {
    const address = "aechat-aaaaaaaaaaaa";
    const cli = fakeCli({
      teamJson: vi.fn(async () => ({
        agents: { [address]: { member_id: "m-1", registrations: [] } },
      })),
      doctorStatus: vi.fn(async () => ({
        mode: "monitor",
        locks: { [`aechat-test/${address}`]: "owner(alive)=sid.123" },
      })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, address);

    await expect(adapter.bind(SESSION, binding)).resolves.toMatchObject({
      state: "bound",
      boundScope: "host_role",
    });
  });

  it("bind does not claim host_role for a roster-only address", async () => {
    const address = "aechat-aaaaaaaaaaaa";
    const cli = fakeCli({
      teamJson: vi.fn(async () => ({
        agents: { [address]: { member_id: "m-1", registrations: [] } },
      })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, address);

    await expect(adapter.bind(SESSION, binding)).resolves.toMatchObject({
      state: "pending",
      boundScope: "none",
    });
  });

  it("register records the actual delivery mode", async () => {
    const cli = fakeCli({
      doctorStatus: vi.fn(async () => ({ mode: "off", locks: {} })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });

    const binding = await adapter.register(SESSION);
    expect(binding.mode).toBe("off");
  });

  it("probe records transport facts without claiming a wakeup level", async () => {
    const address = "aechat-aaaaaaaaaaaa";
    const cli = fakeCli({
      teamJson: vi.fn(async () => ({
        agents: { [address]: { member_id: "m-1", registrations: [] } },
      })),
      doctorStatus: vi.fn(async () => ({
        mode: "monitor",
        locks: { [`aechat-test/${address}`]: "owner(alive)=sid.123" },
      })),
    });
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, address);

    await expect(adapter.probe(binding)).resolves.toMatchObject({
      observedLevel: "unknown",
      busyReceive: null,
      idleWakeup: null,
      evidence: {
        probe: "transport facts only",
        roster: true,
        lock: "alive",
        mode: "monitor",
      },
    });
  });

  it("probe stays unknown when the binding lacks host evidence", async () => {
    const adapter = new AgmsgAdapter({
      cli: fakeCli(),
      team: "aechat-test",
    });
    const binding = {
      transport: "agmsg",
      address: "aechat-aaaaaaaaaaaa",
      team: "aechat-test",
      mode: "monitor",
      state: "bound" as const,
      evidence: {},
      bindDirective: "",
    };

    await expect(adapter.probe(binding)).resolves.toMatchObject({
      observedLevel: "unknown",
      evidence: { probe: "binding lacks client/project evidence" },
    });
  });

  it("probe records why transport facts were unavailable", async () => {
    const adapter = new AgmsgAdapter({
      cli: fakeCli({
        teamJson: vi.fn(async () => {
          throw new Error("agmsg team failed at /Users/other/.claude/config");
        }),
      }),
      team: "aechat-test",
    });
    const binding = {
      transport: "agmsg",
      address: "aechat-aaaaaaaaaaaa",
      team: "aechat-test",
      mode: "monitor",
      state: "bound" as const,
      evidence: { client: "claude-code", project: "/tmp/project" },
      bindDirective: "",
    };

    const probe = await adapter.probe(binding);
    expect(probe).toMatchObject({
      observedLevel: "unknown",
      evidence: {
        probe: "transport facts unavailable",
        stage: "team",
        error: "agmsg team failed at [path]",
      },
    });
    expect(JSON.stringify(probe.evidence)).not.toContain("/Users/other");
  });

  it("inspect reports dead when roster has no matching address", async () => {
    const cli = fakeCli();
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, "aechat-bbbbbbbbbbbb");

    await expect(adapter.inspect(binding)).resolves.toMatchObject({
      state: "dead",
    });
  });

  it("notify sends a pull pointer without body or display name", async () => {
    const cli = fakeCli();
    const adapter = new AgmsgAdapter({ cli, team: "aechat-test" });
    const binding = await adapter.register(SESSION, "aechat-cccccccccccc");

    await adapter.notify(binding, {
      messageId: "msg-1",
      fromSession: "from-session",
      toSession: "target-session",
      fromAddress: "aechat-sender",
    });

    expect(cli.notify).toHaveBeenCalledWith({
      team: "aechat-test",
      from: "aechat-sender",
      to: "aechat-cccccccccccc",
      text:
        "[AeChat] msg=msg-1 session=target-session " +
        "action=aechat inbox --session target-session",
    });
    const call = (cli.notify as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      text: string;
    };
    expect(call.text).not.toContain("dev");
    expect(call.text).not.toContain("body");
  });
});
