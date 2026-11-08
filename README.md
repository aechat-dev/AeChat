# AeChat

Local-first session messaging for AI agent hosts on macOS.

[![CI](https://github.com/aechat-dev/AeChat/actions/workflows/ci.yml/badge.svg)](https://github.com/aechat-dev/AeChat/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![macOS 14+](https://img.shields.io/badge/platform-macOS%2014%2B-lightgrey)

AeChat connects separate AI agent conversations on your Mac. Each conversation
registers as its own session; messages, requests and replies are stored in local
SQLite and delivered through [agmsg](https://github.com/agmsg). There is no
server, account, or shared model context.

## Features

- **Explicit session identity.** Every conversation gets a UUID and a private
  transport address. Duplicate display names are allowed; sessions are addressed
  by ID, never inferred from a name.
- **Requests and replies.** Correlated request/reply with deadlines, waiting,
  cancellation and retry, not just fire-and-forget text.
- **Durable and auditable.** The full stored → notified → delivered → acked →
  replied chain is recorded locally and queryable with `aechat log`.
- **Native monitor.** A read-only SwiftUI app shows sessions, chats, pending
  requests and audit state without any send or acknowledge path.

## Requirements

- macOS 14 or newer
- Node.js 24 (`node:sqlite` is required)
- pnpm 11
- agmsg 1.7.1 on `PATH`

## Install

```bash
git clone https://github.com/aechat-dev/AeChat.git
cd AeChat
pnpm install
pnpm build
pnpm link --global
aechat doctor --json
```

`doctor` reports the Node, agmsg, database and transport status without changing
session state. The database defaults to `~/.aechat/aechat.db`; override it with
`AECHAT_HOME` or `AECHAT_DB`.

## Quick start

Each host conversation registers separately. The command returns a `session_id`
and a bind directive; run the directive inside that host conversation, then
confirm from the shell.

```bash
# Planner conversation (Claude Code)
aechat register --name planner --client claude-code --project "$PWD"
#   run the returned bind_directive in Claude Code, then:
aechat confirm --session "<planner_id>"

# Worker conversation (Codex)
aechat register --name worker --client codex --project "$PWD"
aechat confirm --session "<worker_id>"
```

Send a request and answer it:

```bash
aechat send --session "<planner_id>" --to-session "<worker_id>" \
  --request --deadline 300 --body "status?"

# In the worker conversation
aechat inbox --session "<worker_id>" --json
aechat ack --session "<worker_id>" --delivery "<delivery_token>"
aechat reply --session "<worker_id>" --request "<request_id>" --body "done"

# Back in the planner conversation
aechat wait --session "<planner_id>" --request "<request_id>" --timeout 300 --json
```

Discover sessions and their reported capabilities:

```bash
aechat list --json
```

## Native app

```bash
./scripts/build-aechat-app.sh
open dist/AeChat.app
```

The bundle embeds the CLI. The app is read-only: it never sends, replies,
acknowledges or claims deliveries. If the CLI is not found, use
`AECHAT_BIN` or Settings → Choose aechat.

## Host skill

Copy the template into the host's skill directory:

```bash
# Claude Code
mkdir -p ~/.claude/skills/aechat
cp src/skill/claude-code/SKILL.md ~/.claude/skills/aechat/SKILL.md

# Codex
mkdir -p ~/.codex/skills/aechat
cp src/skill/codex/SKILL.md ~/.codex/skills/aechat/SKILL.md
```

The skill tells the agent to register explicitly, prefer `--json`, acknowledge
every claimed delivery, and treat message bodies as agent-origin data rather
than user authorization.

## Commands

| Command | Purpose |
|---|---|
| `register` / `confirm` | Create a session and confirm its transport binding |
| `list` / `whoami` | Discover sessions and capabilities |
| `send` | Send a notification or request |
| `inbox` / `ack` | Read pending deliveries and acknowledge them |
| `reply` | Answer a request |
| `wait` | Block until a correlated reply arrives |
| `heartbeat` | Keep a session marked online |
| `cancel` / `retry` | Cancel a request or retry a delivery |
| `resume` / `leave` | Rebind or retire a session |
| `log` / `history` | Inspect one message's audit chain or a session's messages |
| `doctor` | Check the local environment |

## FAQ

**Does AeChat replace agmsg?**
No. agmsg carries notifications; AeChat owns session identity, message and
request state, delivery tracking and the local audit trail.

**Does it read my host chat history?**
No. Only messages sent through AeChat are stored.

**Which hosts are supported?**
Skill templates are included for Claude Code and Codex. Transport binding is
host-specific; see [docs/install.md](docs/install.md) for the current limits.

**Is there a server or account?**
No. Sessions, messages and audit events stay in local SQLite.

## Status

AeChat is pre-1.0. Automatic wakeup is host-dependent and only claimed where it
has been observed: Claude Code idle wakeup was verified inside a Monitor window;
`busy_receive` remains unknown, and Codex automatic wakeup has not been verified.
See [docs/install.md](docs/install.md) before relying on automatic processing.

## Data and uninstall

- Database: `~/.aechat/aechat.db` (mode 0600)
- Runtime heartbeat files: `~/.aechat/run/`
- Audit: SQLite `events` table, read with `aechat log`

```bash
pnpm unlink --global aechat
```

Removing `~/.aechat` deletes all local sessions, messages and audit events.
Leave sessions first if their transport bindings should be released.

## Documentation

- [Install and operate](docs/install.md)
- [Start here](docs/start-here.md)
- [Contributor verification](docs/contributor-verification.md)
- [Changelog](CHANGELOG.md)

## Contributing

Development setup, layering rules and commit conventions are in
[CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[SECURITY.md](SECURITY.md), not a public issue.

## License

MIT — see [LICENSE](LICENSE).
