# Roadmap

AeChat is a lightweight, local-first messaging framework for AI agent
sessions. It connects conversations; it does not manage agents. The roadmap is
ordered by that promise, not by feature count. The live execution order is
tracked in [issue #18](https://github.com/aechat-dev/AeChat/issues/18).

## Principles

| Principle | Meaning |
|---|---|
| Minimal | No feature that is not about communication |
| Local-first | Runs on this machine; no server or account |
| Session-first | Every conversation has a stable identity |
| Reliable | Persisted messages, acknowledgements, retries, deduplication |
| Host-agnostic | Core has no branch for a specific agent product |
| Observable | Every message has a traceable lifecycle |
| Non-intrusive | Never interrupts a host that is already working |

Reliable delivery is not the same as exactly-once execution. The receiver must
still make its own side effects idempotent.

## Now

- CLI + skill integration for Claude Code and Codex over agmsg.
- Session identity, discovery, notifications, requests and replies.
- SQLite persistence with an append-only audit trail.
- Read-only macOS monitor: communication health and activity, not a chat
  client. It has no composer and does not manage agents.
- One-command first-run setup (`aechat init`) and automatic binding when the
  host session id is available.

## Next

These are candidates, not commitments. Each starts only after the current
surface is verified against a real host.

1. **Reliability contract.** Write down the message lifecycle, what `ack`
   means, lease/retry/dead-letter behavior, crash recovery, and the
   idempotency expected from a receiver. Add crash-point E2E tests and
   per-message events for expiry, dead letter and leave.
2. **Host adapter contract.** Move host declarations (client id, session
   environment variable, skill location) into the adapter layer. Prove with a
   test host that a new host needs no core change.
3. **Agent-facing simplification.** Reduce the receive path from
   `inbox → ack → reply → wait` to a small high-level surface, without making
   an automatic `ack` claim work that has not happened.

## Later

- One-line install (`npx aechat init` or an installer) and a released CLI.
- MCP and SDK entry points over the same core.
- Groups, broadcast and subscriptions, if they remain communication features.
  See the [group messaging design](group-messaging.md).
- Additional host adapters, written without touching the core.

## Not goals

Token accounting, model quotas, task planning, automatic role assignment,
workflow orchestration and remote device control belong to other tools.

## Evidence

Host capabilities are claimed only from observed behavior. See
[compatibility.md](compatibility.md) for the current matrix and
[e2e.md](e2e.md) for the repeatable protocol.
