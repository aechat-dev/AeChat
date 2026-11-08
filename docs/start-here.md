# Start here

AeChat is a local-first session messaging service for AI agent hosts on macOS.
The unit of communication is one conversation instance, not a model name or a
client name. Messages, requests, replies, delivery state and audit events live
in a local SQLite database; the transport only moves notifications between
hosts.

Read [README.md](../README.md) for the product model and
[docs/install.md](install.md) for installation and host binding.

## Architecture at a glance

```text
src/core        domain, state machines, SQLite persistence, audit
src/adapters    transport and host integration (agmsg, skills)
src/app         composition and read-only query services
src/contracts   JSON DTOs and envelopes for the UI bridge
src/cli         argument parsing and command wiring
apps/macos      SwiftUI read-only monitor, consumes only ui-* commands
```

Two rules matter more than the rest:

1. Host-specific behavior belongs in an adapter. The messaging core must not
   gain a branch for a specific client.
2. Capability claims must match evidence from a real host. "The subscription
   succeeded" is not the same as "the model processed a message".

## Repository map

| Path | What lives there |
|---|---|
| `src/core` | sessions, messages, deliveries, requests, audit, schema |
| `src/adapters` | agmsg transport, host integration, fake transport |
| `src/app` | runtime composition, UI query services, event stream |
| `src/contracts` | UI bridge DTOs |
| `src/cli` | `aechat` command surface |
| `src/skill` | Claude Code and Codex skill templates |
| `apps/macos` | SwiftUI app and `AeChatChecks` |
| `scripts` | build, packaging and test-audit scripts |
| `docs` | install and contributor documentation |

## First 30 minutes

```bash
pnpm install
pnpm check                    # typecheck, lint, test audit, coverage
pnpm build
swift build --package-path apps/macos
swift run --package-path apps/macos AeChatChecks
```

For a runnable app bundle:

```bash
./scripts/build-aechat-app.sh
open dist/AeChat.app
```

You need Node.js 24 and pnpm 11. agmsg 1.7.1 is required only for transport
integration and real-host verification; unit tests use the fake transport.

## Making a change

1. Open an issue for anything larger than a bug fix. Describe the behavior and
   the host or workflow it serves.
2. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for layering, tests and commit
   rules.
3. Keep the change focused. One commit does one thing.
4. Run the checks and record the actual output. Use
   [contributor-verification.md](contributor-verification.md) to pick the
   minimum evidence for your change.
5. Say what you did not run. A skipped real-host test is useful information,
   not a failure to hide.

## What reviewers look for

- The adapter boundary is intact; no host-specific logic in `src/core`.
- Every state transition has an audit event and a test.
- Capability and wakeup claims are limited to observed evidence.
- The native app remains read-only.
- Secrets and local paths do not appear in logs, errors or fixtures.
- The PR states what was compiled, what was run, and what was only read.

## Where to ask

Open a discussion for design questions and an issue for reproducible defects.
Security reports go through [SECURITY.md](../SECURITY.md), never a public issue.
