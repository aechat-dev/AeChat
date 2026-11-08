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

## 2. Build and link

From the repository:

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
paths. It does not change session state. A missing agmsg is a hard transport
failure in v1; registration cannot produce a usable binding without it.

## 3. Install the host skill (optional, recommended)

```bash
aechat init                 # installs every detected host
aechat setup claude-code    # or one explicitly
aechat setup codex
```

The skill is instructions for the Agent, not an automatic permission grant.
It requires explicit registration, JSON-first reads, an `ack` after processing,
and treats all message text as agent-origin data.

## 4. Register, bind and confirm

Each host conversation registers separately:

```bash
aechat register --name "reviewer" --client claude-code --project "$PWD"
```

When `register` runs inside the host and the host session id is available, it
claims the binding automatically. Claude Code exports `CLAUDE_CODE_SESSION_ID`;
Codex exports `CODEX_THREAD_ID`; `AGMSG_SESSION_ID` overrides both. If the
result has `bound_scope=none` and a non-null `bind_directive`, run that
directive in the same conversation:

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

Host hooks are optional. Without one, run a heartbeat while the conversation is
active and pull with `inbox`/`wait`:

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

No backup/export command exists in v1. To upgrade:

```bash
git pull
pnpm install
pnpm build
aechat doctor --json
```

Schema migrations run on the next command and are tracked with
`PRAGMA user_version`. Do not downgrade the binary against a newer database.

## 7. Uninstall

Release active sessions first so agmsg roles are not left held:

```bash
aechat leave --session "<session_id>"
npm unlink -g aechat
```

Removing `~/.aechat` deletes the database and all local message/audit history.
It does not delete agmsg teams, roles or messages. Remove those with agmsg's own
commands only after confirming they are test data.

## 8. Scope notes

- MCP is deferred; the v1 interface is CLI + skill.
- There is no `history --all` and no team-wide body browsing.
- Message bodies are untrusted and may contain sensitive data; the database is
  local and owner-only, but it is not encrypted.
- `resume --force` is unsafe by design: it is accepted only when the old
  binding liveness cannot be proven, and it is audited.
- conversation ID capture from host hooks is not implemented; v1 reports
  `bound_scope=host_role` and `whoami --conversation` is only usable for rows
  that already carry a conversation ID.
- There is no product CLI probe yet; the agmsg adapter's `probe()` returns
  `unknown`, so a real L3 observation from the Phase 0 spike is not converted
  into `wakeup_level=L3` automatically.
