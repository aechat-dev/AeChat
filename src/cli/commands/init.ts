import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { openDatabase } from "../../core/store/db.js";
import { migrate } from "../../core/store/schema.js";
import {
  detectHosts,
  type HostId,
  type InstallResult,
  installHostSkill,
} from "../../runtime/host-install.js";
import { resolvePaths } from "../../runtime/options.js";
import { parseArgs } from "../args.js";
import type { CommandResult } from "../output.js";
import type { CommandContext } from "./context.js";

interface InitData {
  home: string;
  database: string;
  dry_run: boolean;
  agmsg: { version: string | null; ok: boolean; error?: string };
  hosts: InstallResult[];
  next_steps: string[];
}

export type InitContext = Pick<CommandContext, "agmsgVersion">;

function nextSteps(hosts: HostId[]): string[] {
  const steps: string[] = [];
  if (hosts.includes("claude-code")) {
    steps.push(
      'In Claude Code: aechat register --name "<name>" --client claude-code --project "$PWD"',
    );
  }
  if (hosts.includes("codex")) {
    steps.push(
      'In Codex: aechat register --name "<name>" --client codex --project "$PWD"',
    );
  }
  if (steps.length === 0) {
    steps.push("Install Claude Code or Codex, then run: aechat setup <host>");
  }
  steps.push("Check the environment with: aechat doctor --json");
  return steps;
}

function renderText(data: InitData): string {
  const lines = [
    data.dry_run ? "AeChat init (dry run)" : "AeChat initialized",
    `  database: ${data.database}`,
  ];
  lines.push(
    data.agmsg.ok
      ? `  agmsg: ${data.agmsg.version}`
      : `  agmsg: not found (transport unavailable${data.agmsg.error === undefined ? "" : `: ${data.agmsg.error}`})`,
  );
  if (data.hosts.length === 0) {
    lines.push("  skills: no host detected");
  }
  for (const host of data.hosts) {
    lines.push(`  ${host.host} skill: ${host.action} -> ${host.path}`);
  }
  lines.push("Next:");
  for (const step of data.next_steps) {
    lines.push(`  ${step}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function initCommand(
  argv: readonly string[],
  ctx: InitContext,
): Promise<CommandResult> {
  const args = parseArgs(argv);
  const dryRun = args.flags.has("dry-run");
  const json = args.flags.has("json");
  const paths = resolvePaths();

  if (!dryRun) {
    mkdirSync(paths.home, { recursive: true, mode: 0o700 });
    mkdirSync(join(paths.home, "logs"), { recursive: true, mode: 0o700 });
    const db = openDatabase(paths.dbPath);
    try {
      migrate(db);
    } finally {
      db.close();
    }
  }

  let agmsg: InitData["agmsg"] = { version: null, ok: false };
  if (ctx.agmsgVersion !== undefined) {
    try {
      const version = await ctx.agmsgVersion();
      agmsg = { version, ok: version === "1.7.1" };
    } catch (error) {
      agmsg = {
        version: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const hosts = detectHosts();
  const installed = hosts.map((host) => installHostSkill({ host, dryRun }));
  const data: InitData = {
    home: paths.home,
    database: paths.dbPath,
    dry_run: dryRun,
    agmsg,
    hosts: installed,
    next_steps: nextSteps(hosts),
  };

  if (json) {
    return { data };
  }
  return { data, text: renderText(data) };
}
