import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join as joinPath } from "node:path";

import { AechatError } from "../../../core/errors.js";
import { parseAgmsgVersion, type TeamJson } from "./mapping.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options: { timeoutMs: number; env?: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

export interface CommandResult {
  ok: boolean;
  stderr: string;
}

export interface JoinInput {
  team: string;
  address: string;
  client: string;
  project: string;
}

export interface ClaimInput {
  project: string;
  client: string;
  address: string;
  sessionId: string;
}

export interface CodexSessionInput {
  team: string;
  agent: string;
  project: string;
  /** Host thread id used for the record; overrides the ambient env. */
  sessionId: string;
}

export interface NotifyInput {
  team: string;
  from: string;
  to: string;
  text: string;
}

export interface DoctorStatus {
  mode: string;
  /** Keyed by "<team>/<agent>", value is doctor's raw lock= field. */
  locks: Record<string, string>;
}

export interface AgmsgCliPort {
  version(): Promise<string>;
  join(input: JoinInput): Promise<CommandResult>;
  claim(input: ClaimInput): Promise<CommandResult>;
  recordCodexSession(input: CodexSessionInput): Promise<CommandResult>;
  notify(input: NotifyInput): Promise<CommandResult>;
  teamJson(team: string): Promise<TeamJson>;
  deliveryStatus(client: string, project: string): Promise<{ mode: string }>;
  doctorStatus(
    team: string,
    client: string,
    project: string,
  ): Promise<DoctorStatus>;
  leave(team: string, address: string): Promise<void>;
}

/**
 * Uses execFile with an argv array; message bodies are never interpolated into
 * a shell string. Non-zero exits are returned, not thrown, so callers can map
 * them to delivery status without losing stderr.
 */
export const execFileRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
        ...(options.env === undefined ? {} : { env: options.env }),
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const code = (error as { code?: unknown }).code;
        resolve({
          stdout,
          stderr: stderr === "" ? error.message : stderr,
          exitCode: typeof code === "number" ? code : 127,
        });
      },
    );
  });

export interface AgmsgCliOptions {
  scriptsDir?: string;
  runner?: CommandRunner;
  timeoutMs?: number;
}

export class AgmsgCli implements AgmsgCliPort {
  private readonly scriptsDir: string;
  private readonly runner: CommandRunner;
  private readonly timeoutMs: number;

  constructor(options: AgmsgCliOptions = {}) {
    this.scriptsDir =
      options.scriptsDir ??
      joinPath(homedir(), ".agents", "skills", "agmsg", "scripts");
    this.runner = options.runner ?? execFileRunner;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async exec(
    script: string,
    args: readonly string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<ExecResult> {
    try {
      return await this.runner(joinPath(this.scriptsDir, script), args, {
        timeoutMs: this.timeoutMs,
        ...(env === undefined ? {} : { env }),
      });
    } catch (error) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg ${script} could not run: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async version(): Promise<string> {
    const result = await this.exec("version.sh", []);
    if (result.exitCode !== 0) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg version failed: ${result.stderr.trim()}`,
      );
    }
    const version = parseAgmsgVersion(result.stdout);
    if (version === null) {
      throw new AechatError(
        "transport_unavailable",
        "agmsg version output did not contain a version",
      );
    }
    if (version !== "1.7.1") {
      throw new AechatError(
        "transport_unavailable",
        `unsupported agmsg version ${version}; expected 1.7.1`,
      );
    }
    return version;
  }

  async join(input: JoinInput): Promise<CommandResult> {
    const result = await this.exec("join.sh", [
      input.team,
      input.address,
      input.client,
      input.project,
    ]);
    return { ok: result.exitCode === 0, stderr: result.stderr.trim() };
  }

  async claim(input: ClaimInput): Promise<CommandResult> {
    const result = await this.exec("actas-claim.sh", [
      input.project,
      input.client,
      input.address,
      input.sessionId,
    ]);
    return { ok: result.exitCode === 0, stderr: result.stderr.trim() };
  }

  async recordCodexSession(input: CodexSessionInput): Promise<CommandResult> {
    const result = await this.exec(
      "drivers/types/codex/codex-record-session.sh",
      [input.team, input.agent, input.project],
      { ...process.env, CODEX_THREAD_ID: input.sessionId },
    );
    return { ok: result.exitCode === 0, stderr: result.stderr.trim() };
  }

  async notify(input: NotifyInput): Promise<CommandResult> {
    const result = await this.exec("send.sh", [
      input.team,
      input.from,
      input.to,
      input.text,
    ]);
    return { ok: result.exitCode === 0, stderr: result.stderr.trim() };
  }

  async teamJson(team: string): Promise<TeamJson> {
    const result = await this.exec("team.sh", [team, "--json"]);
    if (result.exitCode !== 0) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg team read failed: ${result.stderr.trim()}`,
      );
    }
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("not an object");
      }
      return parsed as TeamJson;
    } catch {
      throw new AechatError(
        "transport_unavailable",
        "agmsg team output was not valid JSON",
      );
    }
  }

  async deliveryStatus(
    client: string,
    project: string,
  ): Promise<{ mode: string }> {
    const result = await this.exec("delivery.sh", ["status", client, project]);
    const match = /(?:mode|delivery)[ \t]*[:=][ \t]*([a-z]+)/i.exec(
      result.stdout,
    );
    return { mode: match?.[1]?.toLowerCase() ?? "unknown" };
  }

  async doctorStatus(
    team: string,
    client: string,
    project: string,
  ): Promise<DoctorStatus> {
    const result = await this.exec("doctor.sh", [
      "--project",
      project,
      "--type",
      client,
      "--team",
      team,
    ]);
    // doctor exits 1 for warnings (for example, a live lock with no watcher),
    // while still printing the facts we need. Only a harder failure is fatal.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg doctor failed: ${result.stderr.trim()}`,
      );
    }
    const mode =
      /^mode:[ \t]*([a-z]+)/im.exec(result.stdout)?.[1]?.toLowerCase() ??
      "unknown";
    const locks: Record<string, string> = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^\s+(\S+)\/(\S+)\s+lock=(.+)$/.exec(line);
      if (match !== null) {
        locks[`${match[1]}/${match[2]}`] = match[3]?.trim() ?? "";
      }
    }
    return { mode, locks };
  }

  async leave(team: string, address: string): Promise<void> {
    const result = await this.exec("leave.sh", [team, address]);
    if (result.exitCode !== 0) {
      throw new AechatError(
        "transport_unavailable",
        `agmsg leave failed: ${result.stderr.trim()}`,
      );
    }
  }
}
