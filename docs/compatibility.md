# Host compatibility

This matrix records what has actually been observed, not what the design
intends. It is updated with every real-host run.

Status legend:

| Mark | Meaning |
|---|---|
| ✅ | Verified at the stated level, with the recorded version and date |
| ◐ | Partially verified; the condition is named in the cell |
| ? | Unknown; no evidence yet |
| ✗ | Not supported |

## Two different claims

Keep these separate:

1. **AeChat transport** — two AeChat sessions can register, bind, send,
   request, pull, acknowledge, reply and audit over the real agmsg transport.
2. **Host processing** — a model in a real host conversation read the message
   and answered it.

The local E2E suite proves (1). It does not prove (2), and a transport
`send_status=stored` is not a failure: it means the target has no host hook, so
the message is durable and pull-only.

## Matrix

| Scenario | Claude Code | Codex | Evidence |
|---|---|---|---|
| Register two isolated sessions | ✅ 2026-11-08 | ? | `pnpm e2e:local` |
| Bind with `bound_scope=host_role` | ✅ 2026-11-08 | ? | `pnpm e2e:local`; Codex claim not confirmed |
| Durable send + pull (`inbox`) | ✅ 2026-11-08 | ? | `pnpm e2e:local` |
| Request → ack → reply → `wait` | ✅ 2026-11-08 | ? | `pnpm e2e:local` |
| Audit chain (`send` → `inbox_claim` → `ack` → `reply`) | ✅ 2026-11-08 | ? | `pnpm e2e:local` |
| Leave and release | ✅ 2026-11-08 | ? | `pnpm e2e:local` |
| Host model reads and replies (manual turn) | ? | ? | Phase 0 spike used agmsg hooks, not AeChat flow |
| Push notification (`notification_receive`) | ? requires host hook | ? | Current local E2E is pull-only |
| Busy receive (`busy_receive`) | ? | ? | Phase 0 saw injection, no reply |
| Idle wakeup (`idle_wakeup`) | ◐ agmsg Monitor only, 2026-11-06 | ? | Not managed by AeChat; re-arm untested |
| Resume / rebind across host restarts | ? | ? | Unit tests only |
| Conversation-level binding | ✗ v1 reports `host_role` | ✗ | No host conversation ID capture |

## Evidence log

### 2026-11-08 — local transport E2E

- Command: `pnpm build && pnpm e2e:local`
- Environment: macOS, Node 24.21.0, agmsg 1.7.1, two `claude-code` identities
  in an isolated `AECHAT_HOME` and temporary agmsg team.
- Result: two sessions bound with `host_role`; request/reply completed; audit
  chain `send → send → inbox_claim → ack → reply`; both sessions left cleanly.
- Delivery was pull-only (`send_status=stored`) because no host hook was
  installed. That is the expected behavior for this harness.

### 2026-11-06 — Phase 0 host spike

- Claude Code 2.1.319, Codex CLI 0.166.0-alpha.6, agmsg 1.7.1.
- Claude Code: turn delivery and idle wakeup inside a Monitor window were
  observed. Busy receive remained unknown.
- Codex: the model turn was blocked by the usage limit; no wakeup evidence.
- This spike used agmsg hooks directly, not the AeChat skill flow. It is
  background evidence, not a product acceptance record.

## Updating the matrix

1. Run the automated suite: `pnpm e2e:local`.
2. Run the manual host protocol in [e2e.md](e2e.md) for the host under test.
3. Add the date, host version, agmsg version and observed result.
4. Downgrade or qualify an existing cell when a run contradicts it.
5. Do not mark a host wakeup capability from a subscription or hook install
   alone; require an `ack` or `reply` from the model.

A release note may only claim a cell marked ✅, and must repeat its condition.
