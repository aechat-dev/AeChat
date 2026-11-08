# AeChat

Local-first session messaging for multiple AI Agent products on macOS.

AeChat treats one **conversation instance** as the communication unit, not a
model name or client name. Each session gets a UUID, a duplicate-capable display
name, and a private transport address. Messages, requests, replies, delivery
state and audit events live in a local SQLite database; agmsg is used only as
the delivery/wakeup transport.

AeChat is pre-1.0. The CLI, the local store and the adapter boundary are usable;
host wakeup claims are limited to what has been verified in a real host. See
[Capabilities and wakeup](#capabilities-and-wakeup) and
[docs/install.md](docs/install.md) before relying on automatic processing.


## Requirements

- macOS
- Node.js >= 24 (`node:sqlite` is required)
- pnpm 11
- agmsg 1.7.1 on `PATH` for the agmsg transport

Check the environment before registering:

```bash
aechat doctor --json
```

## Install

```bash
pnpm install
pnpm build
pnpm link --global
aechat doctor --json
```

`pnpm link --global` exposes the built `aechat` binary. Re-run `pnpm build`
after pulling changes. The database defaults to `~/.aechat/aechat.db`
(owner-only mode 0600). Override with `AECHAT_HOME` or `AECHAT_DB`.

## Native app

`apps/macos` contains the read-only SwiftUI monitor. It reads through the
`ui-*` bridge commands only; it never sends, replies, acknowledges or claims
deliveries.

```bash
./scripts/build-aechat-app.sh
open dist/AeChat.app
```

The bundle embeds the compiled CLI. The app finds it automatically, or use
`AECHAT_BIN` / Settings → Choose aechat. The bundled CLI is a Node script, so a
Node >= 24 install is required; the app looks at `AECHAT_NODE`, `PATH`, common
locations, and fnm/nvm version directories (Finder does not load your shell
profile).

Development checks use `AeChatChecks`, an executable target, because XCTest and
Swift Testing are unavailable with Command Line Tools only:

```bash
./scripts/check-macos.sh   # not `swift test`
```

## Agent skill

Copy the template for the host into its skill directory:

```bash
# Claude Code
mkdir -p ~/.claude/skills/aechat
cp src/skill/claude-code/SKILL.md ~/.claude/skills/aechat/SKILL.md

# Codex
mkdir -p ~/.codex/skills/aechat
cp src/skill/codex/SKILL.md ~/.codex/skills/aechat/SKILL.md
```

The template tells the Agent to register explicitly, prefer `--json`, ack every
claimed delivery, and treat message bodies as agent-origin rather than user
authorization.

## Quick start

Register each conversation separately. Display names may repeat; the returned
`session_id` is the identity.

```bash
aechat register --name "planner" --client claude-code --project "$PWD"
# Run the returned bind_directive inside that host conversation, then:
aechat confirm --session "<session_id>"

aechat register --name "worker" --client codex --project "$PWD"
```

Discover live sessions and their honest capabilities:

```bash
aechat list --json
```

Send to an explicit session. Do not infer a receiver from a display name.

```bash
aechat send --session "<from_id>" --to-session "<to_id>" --body "hello"
aechat send --session "<from_id>" --to-session "<to_id>" \
  --request --deadline 300 --body "status?"
```

On the receiver:

```bash
aechat inbox --session "<to_id>" --json
aechat ack --session "<to_id>" --delivery "<delivery_token>"
aechat reply --session "<to_id>" --request "<request_id>" --body "done"
```

The sender waits for the correlated reply:

```bash
aechat wait --session "<from_id>" --request "<request_id>" --timeout 300 --json
```

`inbox --peek` does not claim a delivery and returns no usable token. Use
`aechat log --message <id>` to inspect the stored → notified → delivered →
acked → replied chain, and `aechat history --session <id>` for the messages
sent or received by one session.

## Lifecycle

```bash
aechat heartbeat --session "<id>"
aechat heartbeat --session "<id>" --interval 30
aechat cancel --session "<id>" --request "<request_id>"
aechat retry --session "<id>" --message "<message_id>"
aechat resume --session "<id>" [--force]
aechat confirm --session "<id>" --resume
aechat leave --session "<id>"
```

`resume` is explicit and two-phase, and is rejected while the old transport
binding is still live. `leave` is terminal; rejoin with a new session.

## Capabilities and wakeup

`list --json` reports `capabilities.supported` and `capabilities.available`
separately. `available` is false when the session is offline or the transport
cannot deliver notifications. `busy_receive` and `idle_wakeup` stay `unknown`
until a probe provides evidence.

Verified by the Phase 0 spike: Claude Code turn delivery and idle wakeup within
the Monitor lifetime. `busy_receive` remains unknown. Codex wakeup was not
verified because its model usage was blocked; no Codex automatic wakeup is
promised. See `docs/install.md` for the current limits.

## Data and uninstall

- Database: `~/.aechat/aechat.db` (0600)
- Audit: `events` table; inspect with `aechat log`
- Runtime files: `~/.aechat/run/`
- Log directory: `~/.aechat/logs/` (JSONL mirroring is not implemented; the
  SQLite events table is the audit source)

Uninstall the binary with `pnpm unlink --global aechat`. Removing
`~/.aechat` deletes all local sessions, messages and audit events; leave
sessions first if the transport bindings should be released.

## Scope

v1 is CLI + host skill. MCP is explicitly deferred and is not required for
acceptance. The service does not read host chat history and does not provide
`history --all` or team-wide message browsing. conversation ID capture from
host hooks and a product probe command are not implemented; v1 reports
`bound_scope=host_role` and leaves probe-derived wakeup levels at `unknown`
until that evidence path exists.

## Contributing

New contributors start with [docs/start-here.md](docs/start-here.md). It maps
the repository, lists the first commands to run, and explains what reviewers
look for. [docs/contributor-verification.md](docs/contributor-verification.md)
defines the evidence expected for each kind of change.

Development setup, layering rules, test commands and commit conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md). Security issues must be reported privately
per [SECURITY.md](SECURITY.md), not in a public issue.

## License

MIT — see [LICENSE](LICENSE).

