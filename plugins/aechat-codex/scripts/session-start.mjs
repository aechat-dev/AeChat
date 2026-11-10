#!/usr/bin/env node
// Codex SessionStart hook: attach this conversation before the first turn.
// Runs from the plugin so one trust covers every project. The thread id is
// supplied by Codex in the hook payload; it is not assumed to be in the env.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function findBinary() {
  if (process.env.AECHAT_BIN) return process.env.AECHAT_BIN;
  const found = spawnSync("sh", ["-lc", "command -v aechat"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (found.status === 0 && found.stdout.trim() !== "") {
    return found.stdout.trim();
  }
  for (const candidate of [
    join(homedir(), ".local", "bin", "aechat"),
    "/opt/homebrew/bin/aechat",
    "/usr/local/bin/aechat",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

const logDir = join(
  process.env.AECHAT_HOME ?? join(homedir(), ".aechat"),
  "logs",
);
const logFile = join(logDir, "codex-session-start.log");
function log(line) {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`, {
      mode: 0o600,
    });
    // mode only applies when the file is created; an older 0644 log stays.
    chmodSync(logFile, 0o600);
  } catch {
    // A hook must never block the host on logging failures.
  }
}

const raw = readStdin();
const payload = parsePayload(raw);
const session =
  typeof payload.session_id === "string" ? payload.session_id : "";
const hasCwd = typeof payload.cwd === "string" && payload.cwd.startsWith("/");
const cwd = hasCwd ? payload.cwd : process.cwd();

const binary = findBinary();
if (binary === "") {
  log("skip: aechat not found; set AECHAT_BIN");
  process.exit(0);
}

// agmsg derives the instance id from the agent process. A hook process is not
// an agent, so without this the claim falls back to the bare session id and is
// refused. Walk up to the Codex app-server (or take AECHAT_AGENT_PID in tests).
function commandOf(pid) {
  const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 2_000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function parentOf(pid) {
  const result = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], {
    encoding: "utf8",
    timeout: 2_000,
  });
  return result.status === 0 ? Number(result.stdout.trim()) : NaN;
}

function findAgentPid() {
  if (process.env.AECHAT_AGENT_PID) return process.env.AECHAT_AGENT_PID;
  let pid = process.ppid;
  for (let hops = 0; hops < 20 && Number.isInteger(pid) && pid > 1; hops++) {
    const command = commandOf(pid);
    if (/codex/i.test(command) && /app-server/.test(command)) {
      return String(pid);
    }
    pid = parentOf(pid);
  }
  const found = spawnSync(
    "pgrep",
    ["-f", "CodexCLI.app/Contents/MacOS/codex.*app-server"],
    { encoding: "utf8", timeout: 2_000 },
  );
  if (found.status === 0) {
    const pids = found.stdout.trim().split("\n").filter(Boolean);
    if (pids.length > 0) return pids[pids.length - 1];
  }
  return "";
}

const agentPid = findAgentPid();

// Forward the payload on stdin and let attach resolve session_id there. That
// keeps one precedence rule: hook stdin beats AGMSG_SESSION_ID/CODEX_THREAD_ID.
const result = spawnSync(
  binary,
  [
    "attach",
    "--client",
    "codex",
    "--project",
    cwd,
    "--stdin-session",
    "--json",
  ],
  {
    env: {
      ...process.env,
      ...(agentPid === "" ? {} : { AGMSG_AGENT_PID: agentPid }),
    },
    input: raw,
    encoding: "utf8",
    timeout: 30_000,
  },
);
let bound = "";
try {
  const parsed = JSON.parse(result.stdout ?? "{}");
  bound = typeof parsed?.data?.bound_scope === "string" ? parsed.data.bound_scope : "";
} catch {
  bound = "";
}
log(
  `session=${session} cwd=${cwd}${hasCwd ? "" : " (cwd fallback)"} ` +
    `agent=${agentPid === "" ? "none" : agentPid} ` +
    `bound=${bound === "" ? "unknown" : bound} ` +
    `exit=${result.status ?? "null"} ` +
    `${(result.stderr ?? "").trim().slice(0, 300)}`,
);
process.exit(0);
