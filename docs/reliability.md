# Reliability contract

This page states what AeChat guarantees and what it does not. The guarantees
are limited to local, single-user operation over the agmsg transport.

## Delivery is at-least-once

AeChat may deliver the same message more than once. It does not guarantee that
an agent executes a side effect exactly once. The receiver must make its own
work idempotent, using the stable `message_id` as the idempotency key.

`--dedup-key` only deduplicates **sends from the same session**. It does not
deduplicate receiver execution, replies, or retries after a lease expires.

## Lifecycle

```text
message:   stored ──notify──▶ notified ──inbox──▶ delivered ──ack──▶ acked
              │                    │                  │
              └──notify_fail───────┘                  └──lease + attempts──▶ dead_letter
              └──ttl expired──────────────────────────────────────────────▶ expired

request:   open ──reply──▶ replied
              ├──deadline──▶ expired
              └──cancel / leave──▶ cancelled
```

Every state change and its audit event commit in the same SQLite transaction.
`aechat log` reads the resulting chain in time order.

## What each state means

| State | Meaning |
|---|---|
| `stored` | The message and delivery are durable; no notification was sent |
| `notified` | The transport accepted a notification; the host has not pulled it |
| `delivered` | A host claimed the delivery with a token and a 30-second lease |
| `acked` | The host says it processed the message; this is not proof of a side effect |
| `notify_failed`, `stored` | The sender can retry with `aechat retry` |
| `expired` | The message TTL or request deadline passed |
| `dead_letter` | The delivery was claimed three times without an acknowledgement |
| `replied` | A reply message exists for the request |
| `cancelled` | The requester cancelled, or either side left |

`ack` means **processed**, not merely read. Do not acknowledge automatically
when a message is fetched. A reply also acknowledges the request delivery.

## Crash recovery

The test fixture kills the process with `SIGKILL` at each boundary and reopens
the database. The observed behavior is:

| Crash point | Survives | Recovery |
|---|---|---|
| During the send transaction | Nothing from that send | Resend; no orphan row or event |
| After the send commit, before notify | Message, delivery, `send` event | Pull with `inbox`, or `retry` if the delivery is `stored`/`notify_failed` |
| During a claim | Delivery keeps its previous status (`stored`/`notified`); no token or lease | Claim again |
| After the claim commit, before ack | `delivered`, token, 30-second lease, `inbox_claim` event | The lease expires, then the next `inbox` reclaims it (attempts +1) |
| After ack, before reply | `acked`; request remains `open` | Send the reply against the same request |
| After the reply commit | Reply message, delivery, `replied` request, `reply` event | Continue normally |

The executable evidence is `tests/e2e/crash-recovery.test.ts`, run by
`pnpm test`. The transport-level happy path is `pnpm e2e:local`.

## Operational rules

- Run `aechat inbox` while the host is active; it lazily expires TTL messages
  and dead-letters exhausted leases before claiming new work.
- Do not treat `notified` as processed. Only `ack` or `reply` proves the host
  took responsibility.
- After a `dead_letter`, inspect with `aechat log --message <id>` and create a
  new message if the work still matters; dead letters are not retried in place.
- Use `aechat wait` for an expected reply; use `aechat history` for a session
  view.
- A process that exits without `leave` is recovered by lease expiry and the
  next `inbox`. Call `leave` when a session is intentionally retired.

## Boundaries

AeChat does not provide distributed transactions, exactly-once execution,
remote delivery, or automatic host wakeup as part of this contract. Host
capability and wakeup evidence live in [compatibility.md](compatibility.md).
