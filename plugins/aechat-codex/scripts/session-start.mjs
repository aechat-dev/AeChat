#!/usr/bin/env node
// Codex SessionStart hook: attach this conversation before the first turn.
// Runs from the plugin so one trust covers every project. The thread id is
// supplied by Codex in the hook payload; it is not assumed to be in the env.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

function readPayload() {
  try {
    const parsed = JSON.parse(readFileSync(0, "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function findBinary() {
  if (process.env.AECHAT_BIN) return process.env.AECHAT_BIN;
  const found = spawnSync("sh", ["-lc", "command -v aechat"], {
    encoding: "utf8",
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

const logDir = join(process.env.AECHAT_HOME ?? join(homedir(), ".aechat"), "logs");
function log(line) {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      join(logDir, "codex-session-start.log"),
      `${new Date().toISOString()} ${line}\n`,
      { mode: 0o600 },
    );
  } catch {
    // A hook must never block the host on logging failures.
  }
}

const payload = readPayload();
const session = typeof payload.session_id === "string" ? payload.session_id : "";
const cwd =
  typeof payload.cwd === "string" && payload.cwd.startsWith("/")
    ? payload.cwd
    : process.cwd();

if (session === "") {
  log("skip: hook payload has no session_id");
  process.exit(0);
}

const binary = findBinary();
if (binary === "") {
  log("skip: aechat not found; set AECHAT_BIN");
  process.exit(0);
}

const result = spawnSync(
  binary,
  ["attach", "--client", "codex", "--project", cwd, "--json"],
  {
    env: { ...process.env, CODEX_THREAD_ID: session },
    encoding: "utf8",
    timeout: 30_000,
  },
);
log(
  `session=${session} cwd=${cwd} exit=${result.status ?? "null"} ` +
    `${(result.stderr ?? "").trim().slice(0, 300)}`,
);
process.exit(0);
