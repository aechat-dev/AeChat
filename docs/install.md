# Install and operate AeChat

## 1. Prerequisites

- macOS, Node.js >= 24, pnpm 11.
- agmsg 1.7.1 installed and available as `agmsg`. Verify:

```bash
agmsg --version
# agmsg 1.7.1
```

AeChat registers each conversation in the agmsg team as a
`aechat-<12 lowercase hex>` address. The agmsg delivery mode (`monitor`,
`agmsgd`, `turn`, `off`, `unknown`) is read from agmsg; AeChat does not invent
one.

## 2. Install

Install with the release installer:

```bash
curl -fsSLO https://raw.githubusercontent.com/aechat-dev/AeChat/main/scripts/install.sh
bash install.sh
aechat init
aechat doctor --json
```

The installer is attached to each new release; the URL above works until the
next tag is published.

`bash install.sh --help` lists the options: `--version <tag>` for an exact
release, `--stable` to skip prereleases, `--prefix <dir>` for a non-default
install root, and `--dry-run` to print the plan.

Registry publication is not available yet; the installer uses the GitHub
release tarball and verifies `SHA256SUMS`. The release also publishes
`AeChat.app.zip`. The app is ad-hoc signed, not notarized: if macOS quarantines
a downloaded copy, open it once with right-click → Open, or remove the attribute
with `xattr -d com.apple.quarantine AeChat.app`.

### Manual install

```bash
version=0.1.0-alpha.1
base=https://github.com/aechat-dev/AeChat/releases/download/v$version
curl -fsSLO "$base/aechat-$version.tgz"
curl -fsSLO "$base/SHA256SUMS"
grep "  aechat-$version.tgz$" SHA256SUMS | shasum -a 256 -c -
npm install -g "aechat-$version.tgz"
aechat init
aechat doctor --json
```

`SHA256SUMS` covers both the CLI tarball and `AeChat.app.zip`; the command
above verifies only the tarball being installed.

### From the repository (development)

```bash
pnpm install
pnpm build
npm link
aechat init
aechat doctor --json
```

`npm link` exposes the built CLI as `aechat` on your `PATH`. If it is not
found, add the `bin` directory under `npm config get prefix` to `PATH`, then
run `aechat init` again. `pnpm add -g .` is not used because pnpm 11 removed
`pnpm link --global`, and `pnpm add -g .` adds a self-dependency to this
checkout.

`init` creates the database, checks agmsg and installs the host skill for every
detected host. `doctor` reports the Node version, agmsg version and support
flag, database health/mode, log directory, transport bindings and host hook
paths. Hook paths follow each host's config directory, so `CLAUDE_CONFIG_DIR`
and `CODEX_HOME` also move the files `doctor` inspects. It does not change
session state. A missing agmsg is a hard transport failure in v1; registration
cannot produce a usable binding without it.

## 3. Install the host skill (optional, recommended)

```bash
aechat init                 # installs every detected host
aechat setup claude-code    # or one explicitly
aechat setup codex
```

Host ids come from the adapter registry; the built-in ids are `claude-code`
and `codex`. A host id must match `[a-z0-9][a-z0-9-]{0,31}`; core rejects
anything else before registration touches the transport. A new host adds a
descriptor (including its config directory and hook file) and a skill; core
and the CLI need no host branch. Host-specific transport hints, such as the
agmsg bind directive, stay in the adapter layer.

The skill is instructions for the Agent, not an automatic permission grant.
It requires explicit registration, JSON-first reads, an `ack` after processing,
and treats all message text as agent-origin data.

Codex needs an agmsg delivery path that can reach its conversation. Configure
the project once:

```bash
aechat setup codex --hooks --project "$PWD"
```

The command prefers `agmsgd`, which queues notices into the Codex app-server;
no shell shim is needed. agmsg still installs the project's `SessionStart` hook
so it can start agmsgd's delivery, and the command prints
`codex delivery: configured (agmsgd -> <hook path>)`. The agmsgd path was
verified with the Codex desktop app on 2026-11-09; see
[compatibility.md](compatibility.md) for the exact conditions. For the desktop
app, agmsgd's recorded Codex executable must point at the CLI bundled inside
`ChatGPT.app` (`.../codex-cli/CodexCLI.app/Contents/MacOS/codex`); if it points
at a terminal shim, agmsgd fails with `queue_exit_127` and no notice arrives.
When agmsgd is unavailable, the command falls back to the legacy `monitor`
bridge, in which case Codex must be launched through the agmsg shim.

Without either path, registration still stores the session and the pull path
works, but messages are not delivered automatically and `bound_scope` may stay
`none`.

## 4. Register, bind and confirm

Each host conversation registers separately:

```bash
aechat register --name "reviewer" --client claude-code --project "$PWD"
```

When `register` runs inside the host and the host session id is available, it
claims the binding automatically. Claude Code exports `CLAUDE_CODE_SESSION_ID`;
Codex exports `CODEX_THREAD_ID`; `AGMSG_SESSION_ID` overrides both. The host
session id is also stored as `conversation_id`, so `whoami --conversation`
addresses that exact conversation. If the result has `bound_scope=none` and a
non-null `bind_directive`, run that directive in the same conversation:

- Claude Code: `/agmsg actas <address>`
- Codex: `$agmsg actas <address>`

Then confirm from the shell:

```bash
aechat confirm --session "<session_id>"
```

If `auto_bind.transportClaimState` is `accepted` or `unknown` but
`auto_bind.claimed` is false, the claim may hold the role without a confirmed
binding; do not run another `actas`. Follow `auto_bind.reason` (`aechat confirm`,
or `aechat leave` then register again).

`confirm` only reports `bound` when agmsg has a live actas lock for that
address. A successful agmsg team join without a live lock is not a valid
binding. AeChat reports `bound_scope=host_role` in v1; it does not claim
conversation-level matching unless the host provides it.

Check the result:

```bash
aechat list --json
aechat whoami --session "<session_id>"
```

Do not use a display name as an identity. `send --to-name` fails with candidates
when names are duplicated; choose the intended `session_id`.

## 5. Host hooks and delivery mode

Host hooks are optional. A Claude Code conversation can arm `aechat watch` as a
background task; each new message becomes a conversation event, and the agent
claims it with `receive` before acknowledging. The watch shows at most
`--limit` pending messages (100 by default) and does not update `last_seen`;
a host Monitor task expires, and re-arming after expiry has not been verified,
so the agent should try to re-arm and tell the user when delivery may have
paused. Without a watcher, run
a heartbeat while the conversation is active and pull with `receive` (one
message), `inbox` (a batch) or `wait --request` (a correlated reply). `receive`
exits 2 when no message arrives within `--timeout`; that is an empty poll, not a
delivery failure:

```bash
aechat heartbeat --session "<session_id>" --interval 30
```

The process writes `~/.aechat/run/<session_id>.heartbeat.pid` and removes it on
SIGTERM/SIGINT. Stop it before `leave`.

agmsg's own delivery mode is independent of AeChat. A `turn`/`off` project can
still use `inbox` manually; `send` then stores the message and does not claim
automatic wakeup. `aechat list --json` reports what is actually available.

Claude Code L3 idle wakeup was observed only within the Monitor lifetime
(`watch.sh --max-seconds=1750`). Re-arming after the window expires is not
verified. Busy receive remains unknown.

Codex automatic wakeup has no model-turn evidence yet; the Phase 0 test was
blocked by the Codex usage limit. Do not include Codex wakeup in an acceptance
claim until it is retested.

The current evidence matrix and the repeatable verification protocol are in
[compatibility.md](compatibility.md) and [e2e.md](e2e.md).

## 6. Data, backup and upgrade

- Database: `~/.aechat/aechat.db`, owner-only mode 0600.
- Audit events: SQLite `events` table; read with `aechat log --message <id>`.
- Runtime heartbeat PID files: `~/.aechat/run/`.
- Logs directory: `~/.aechat/logs/` (reported by `doctor`; JSONL mirroring is
  not implemented, the SQLite `events` table is the audit source).

No backup/export command exists in v1. For a source checkout (development):

```bash
git pull
pnpm install
pnpm build
aechat doctor --json
```

For an installed release, follow section 8 instead. Schema migrations run on
the next command and are tracked with `PRAGMA user_version`. Do not downgrade
the binary against a newer database.

## 7. Uninstall

Release active sessions first so agmsg roles are not left held:

```bash
aechat leave --session "<session_id>"
npm uninstall -g aechat   # release tarball install
npm unlink -g aechat      # development `npm link`
```

Removing `~/.aechat` deletes the database and all local message/audit history.
It does not delete agmsg teams, roles or messages. Remove those with agmsg's own
commands only after confirming they are test data.

## 8. Upgrade and rollback

Install the newer tarball (the section 2 installer or manual commands) over the
existing CLI; `npm install -g` replaces the previous files. Check the result
before using it:

```bash
aechat doctor --json
```

Back up `~/.aechat/aechat.db` before an upgrade. Rollback reinstalls the
previous release tarball, but do not run an older binary against a database
migrated by a newer one: the schema version is one-way. If the older binary
refuses the database, restore the backup taken before the upgrade.

Prerelease tags (`v*-alpha.*`) are published as GitHub prereleases; they are
not selected by `/releases/latest`.

## 9. Scope notes

- MCP is deferred; the v1 interface is CLI + skill.
- There is no `history --all` and no team-wide body browsing.
- Message bodies are untrusted and may contain sensitive data; the database is
  local and owner-only, but it is not encrypted.
- `resume --force` is unsafe by design: it is accepted only when the old
  binding liveness cannot be proven, and it is audited.
- conversation ID capture from host hooks is not implemented; v1 reports
  `bound_scope=host_role` and `whoami --conversation` is only usable for rows
  that already carry a conversation ID.
- `aechat probe --session "<session_id>"` records one adapter observation and
  returns a normalized observation (`observed_level`, plus null
  `busy_receive`/`idle_wakeup` when unproven). `list --json` is the normalized view: its
  `capabilities.wakeup_level` reflects that probe and `supported` turns nulls
  into false. The agmsg adapter still returns `unknown` until it can prove a
  level, so a real L3 observation from the Phase 0 spike is not converted into
  `wakeup_level=L3` automatically.
