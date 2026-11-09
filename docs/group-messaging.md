# Group messaging, MCP and SDK design

Status: design note, not implemented.

AeChat connects sessions; it does not plan work, assign roles or own a shared
model context. Groups must stay inside that boundary. This note defines the
smallest group surface that is still useful, plus thin MCP and SDK facades
over the same core.

## Goals

- Send one notification to a named set of sessions without changing the direct
  message model.
- Keep per-recipient delivery, acknowledgement, retry and audit behaviour
  identical to point-to-point messages.
- Let a session leave or be removed without breaking later sends.
- Expose the same operations through the CLI, MCP and an SDK without
  duplicating semantics.
- Keep the existing `messages` and `deliveries` tables readable by older
  clients.

## Non-goals

- Planning, task assignment, token accounting or model selection. The caps
  below are safety limits, not quotas.
- Shared conversation memory or automatic summarisation.
- Strong cross-recipient ordering or distributed consensus.
- Automatic replies, automatic acknowledgements or host wakeup guarantees.
- Remote groups, accounts or a server. Groups are local rows in the same
  SQLite store.

## Data model

Group data lives in new tables. `messages` and `deliveries` are unchanged, so
an older CLI or app can still open the store and read direct messages.

```text
groups
  group_id       TEXT PRIMARY KEY
  name           TEXT NOT NULL
  created_by     TEXT NOT NULL REFERENCES sessions(session_id)
  created_at     TEXT NOT NULL
  deleted_at     TEXT NULL

  UNIQUE (name) WHERE deleted_at IS NULL

group_members
  group_id       TEXT NOT NULL REFERENCES groups(group_id)
  session_id     TEXT NOT NULL REFERENCES sessions(session_id)
  joined_at      TEXT NOT NULL
  left_at        TEXT NULL
  PRIMARY KEY (group_id, session_id)

group_messages
  message_id     TEXT PRIMARY KEY
  group_id       TEXT NOT NULL REFERENCES groups(group_id)
  from_session   TEXT NOT NULL REFERENCES sessions(session_id)
  body           TEXT NOT NULL
  dedup_key      TEXT NULL
  created_at     TEXT NOT NULL
  expires_at     TEXT NULL

  UNIQUE (from_session, group_id, dedup_key) WHERE dedup_key IS NOT NULL

group_deliveries
  delivery_id       TEXT PRIMARY KEY
  message_id        TEXT NOT NULL REFERENCES group_messages(message_id)
  session_id        TEXT NOT NULL REFERENCES sessions(session_id)
  status            TEXT NOT NULL CHECK (status IN (
                      'stored', 'notified', 'delivered', 'acked',
                      'notify_failed', 'expired', 'dead_letter'))
  delivery_token    TEXT NULL
  lease_expires_at  TEXT NULL
  attempts          INTEGER NOT NULL DEFAULT 0
  notified_at       TEXT NULL
  delivered_at      TEXT NULL
  acked_at          TEXT NULL
  last_error        TEXT NULL
```

Unique constraints and indexes, written as SQLite requires them:

```sql
CREATE UNIQUE INDEX groups_active_name
  ON groups(name) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX group_messages_dedup
  ON group_messages(from_session, group_id, dedup_key)
  WHERE dedup_key IS NOT NULL;
CREATE UNIQUE INDEX group_deliveries_message_session
  ON group_deliveries(message_id, session_id);
CREATE UNIQUE INDEX group_deliveries_token
  ON group_deliveries(delivery_token)
  WHERE delivery_token IS NOT NULL;

CREATE INDEX group_members_session ON group_members(session_id);
CREATE INDEX group_messages_group ON group_messages(group_id, created_at);
CREATE INDEX group_deliveries_session
  ON group_deliveries(session_id, status, lease_expires_at);
CREATE INDEX group_deliveries_lease
  ON group_deliveries(status, lease_expires_at);
```

`group_deliveries` has no `replied_at`: group messages cannot be requests, so
`acked` is terminal.

Group messages are notifications only. They carry no `request_id`, `reply_to`
or request deadline; `send --to-group --request` is rejected with
`invalid_input`. This avoids a "first reply wins" rule that would become
hidden orchestration.

### Membership lifecycle

- `add` inserts a member with `joined_at`; adding an existing member is
  idempotent and does not rewrite `joined_at`.
- `remove` and `leave` set `left_at`. Rows stay for history; a re-add clears
  `left_at` and updates `joined_at`.
- `delete` sets `groups.deleted_at`. History keeps the name; new sends are
  rejected with `group_not_found` on name lookup; the name becomes reusable because the unique
  index only covers active groups.
- `group show` reports active and left members separately. Deleted groups are
  only visible with `group show --group-id <id> --all`.

Any registered session may create or manage a group. `created_by` is audit
data, not an authorization rule; the store is local and already trusted.

Names are trimmed and lower-cased, with the same shape as session client ids:
`[a-z0-9][a-z0-9-]{0,31}`. Commands resolve names against active groups only.
A deleted group can only be addressed by `--group-id`, which avoids ambiguity
when a name is reused. `group_id` is a UUID generated at create time.

A session's global `aechat leave` is independent of group membership. Active
membership therefore means `group_members.left_at IS NULL AND
sessions.left_at IS NULL`; `group show` merges both states.

## Delivery semantics

1. `send --to-group <name>` resolves the group and its active members
   (`group_members.left_at IS NULL AND sessions.left_at IS NULL`) in the same
   transaction that inserts the group message and deliveries.
2. The sender is excluded unless `--include-self` is passed. If the sender is
   not a member, `--include-self` has no effect.
3. Members removed from the group or globally left are skipped and recorded in
   the send event as both a count and their session ids.
4. No active recipient (including a sender-only group without
   `--include-self`) fails with `group_empty` and inserts nothing.
5. One delivery token per recipient. Inbox, receive, ack, retry and wait use
   the unified reads described below, so the per-delivery state machine is
   identical.
6. Fan-out is atomic: either the group message and all deliveries commit, or
   none do. Notification attempts happen after commit and may partially fail;
   each failure lands on its own delivery and follows the normal retry path.
7. A group send succeeds once the message and deliveries are stored, even if
   some notifications fail. The result reports per-recipient status.

`--dedup-key` is scoped to `(from_session, group_id)`. A repeated key returns
the existing group message and its current per-recipient deliveries instead
of fanning out again, matching the direct dedup contract. `--ttl` writes
`group_messages.expires_at`; an expired group message cannot be claimed.
Reusing a key with a different body fails with `invalid_input`, matching the
direct dedup contract.

Ordering is per message and per recipient. AeChat does not promise that two
recipients observe messages in the same order, or that a group send is
delivered before an unrelated direct message.

### Unified delivery reads

Reads use two views with a fixed column list:

```sql
CREATE VIEW all_deliveries AS
SELECT 'direct' AS source, d.delivery_id, d.message_id, d.session_id,
       d.status, d.delivery_token, d.lease_expires_at, d.attempts,
       d.notified_at, d.delivered_at, d.acked_at, d.replied_at,
       d.last_error, m.expires_at, m.created_at
FROM deliveries d JOIN messages m ON m.message_id = d.message_id
UNION ALL
SELECT 'group', gd.delivery_id, gd.message_id, gd.session_id,
       gd.status, gd.delivery_token, gd.lease_expires_at, gd.attempts,
       gd.notified_at, gd.delivered_at, gd.acked_at, NULL,
       gd.last_error, gm.expires_at, gm.created_at
FROM group_deliveries gd
JOIN group_messages gm ON gm.message_id = gd.message_id;

CREATE VIEW all_inbox_rows AS
SELECT d.delivery_id, d.session_id, d.status, d.delivery_token,
       'direct' AS source, m.message_id, m.kind, m.from_session,
       m.to_session, NULL AS group_id, NULL AS group_name,
       m.body, m.created_at, m.expires_at
FROM deliveries d JOIN messages m ON m.message_id = d.message_id
UNION ALL
SELECT gd.delivery_id, gd.session_id, gd.status, gd.delivery_token,
       'group', gm.message_id, 'notify', gm.from_session,
       NULL, gm.group_id, g.name, gm.body, gm.created_at, gm.expires_at
FROM group_deliveries gd
JOIN group_messages gm ON gm.message_id = gd.message_id
JOIN groups g ON g.group_id = gm.group_id;
```

The shared inbox item gains `source` and optional group fields:

```json
{
  "source": "group",
  "delivery_id": "…",
  "delivery_token": "…",
  "status": "stored",
  "message": {
    "message_id": "…",
    "kind": "notify",
    "from_session": "…",
    "to_session": null,
    "group_id": "…",
    "group": "planners",
    "body": "…",
    "created_at": "…",
    "expires_at": null
  }
}
```

Direct items keep their current shape with `source: "direct"` and
`to_session` set. `receive`, `wait` and `retry` return the same union type.

Writes cannot go through a view. Claim, ack, retry and expiry read
`all_deliveries` (including its `expires_at`) to find `source`, then update
exactly one table inside the same transaction. Only delivery rows carry
status: expiry updates `deliveries` or `group_deliveries` to `expired`, while
the message row is not rewritten and its `expires_at` continues to express
message expiry, matching the existing direct path. Resume resets `delivered`
group deliveries to `notified`, clears the token and lease, and makes them
claimable again. The delivery state machine, including expiry and resume
reset, runs once in a shared helper parameterized by the target tables; it
does not copy the logic.

Delivery tokens are unique within their source table; `ack` always filters by
both session and token, so a cross-table token collision cannot select the
wrong row.

## Response and log contracts

`send --to-group --json` returns a group envelope rather than the direct
`SendResult`:

```json
{
  "message_id": "…",
  "group_id": "…",
  "group": "planners",
  "recipients": 2,
  "skipped": 1,
  "deliveries": [
    { "session_id": "…", "delivery_id": "…", "status": "notified", "error": null }
  ]
}
```

`status` is the state after the notification attempt. Exit code is 0 when the
message was stored; `group_empty` and `group_not_found` are errors before any
write.

`aechat log --message <group_message_id> --json` returns one group log:

```json
{
  "message_id": "…",
  "kind": "group_notify",
  "group_id": "…",
  "group": "planners",
  "from_session": "…",
  "created_at": "…",
  "deliveries": [
    {
      "session_id": "…",
      "delivery_id": "…",
      "status": "acked",
      "chain": []
    }
  ]
}
```

Direct-message `log` output is unchanged.

Error codes before any write:

| Code | Condition |
|---|---|
| `group_not_found` | no active group with that name |
| `group_empty` | no active recipient after exclusions |
| `group_exists` | create with an active name |
| `group_full` | adding a 65th member |
| `group_limit` | creating a 33rd active group |
| `member_not_found` | remove targets a non-member |
| `invalid_input` | bad name, or `--request` with `--to-group` |

`add` is idempotent for an existing active member; it does not update
`joined_at`. Adding to a globally left session is allowed, but the session
stays inactive for sends until it resumes. Commands that take a name only
resolve active groups; `--group-id` may address a deleted group for
`group show` only.

## CLI

```bash
aechat group create --name planners
aechat group add --group planners --session "<session_id>"
aechat group remove --group planners --session "<session_id>"
aechat group leave --group planners --session "<session_id>"
aechat group delete --group planners
aechat group list [--all] [--json]
aechat group show --group planners [--json]
aechat group show --group-id "<group_id>" [--all] [--json]

aechat send --session "<sender_id>" --to-group planners --body "status?"
```

`group show` reports members, join times and active/left state. It does not
report host capabilities; those stay per session.

## Events and audit

Every group operation writes an event:

- `group_create`, `group_add`, `group_remove`, `group_leave`, `group_delete`;
- `send` with
  `data: { group_id: "…", group: "<name>", recipients: <n>,
  skipped: [<session_id>...] }`;
- the usual per-delivery events for each recipient.

Per-delivery chains remain `stored → notified → delivered → acked`. The group
send itself has no single delivery state.

## MCP facade

MCP is a transport for the same commands, not a second implementation. The
server exposes:

- tools: `send`, `inbox`, `receive`, `ack`, `reply`, `wait`, `list`, `whoami`,
  `log`, `history`, `group_create`, `group_add`, `group_remove`,
  `group_leave`, `group_delete`, `group_list`, `group_show`;
- the same 16 KiB body limit, session identity requirement and `--json`
  envelopes;
- message bodies as untrusted agent-origin data, never as instructions or
  resources.

`history` returns direct and group messages for the requested session, with
the same source/group fields as inbox items. The MCP server runs locally and
uses the same SQLite store. It must not invent automatic acknowledgements:
`receive` claims, `ack` is explicit.

## SDK facade

The SDK is a typed wrapper over the CLI envelope, not a new protocol. A first
version needs only:

```ts
send(input: DirectSendInput | GroupSendInput): Promise<SendResult | GroupSendResult>
inbox(input): Promise<InboxPage<DeliveryItem>>
receive(input): Promise<DeliveryItem | null>
ack(input): Promise<AckResult>
reply(input): Promise<ReplyResult>
wait(input): Promise<WaitResult<DeliveryItem>>
log(input): Promise<LogResult | GroupLog>
history(input): Promise<MessagePage<MessageItem>>
groups: { create, add, remove, leave, delete, list, show }
```

`InboxPage.items`, `receive` and `wait` return the same union item shown
above, so `GroupDeliveryItem` and `DirectDeliveryItem` are explicit SDK types.
The SDK keeps the session id explicit on every call. It does not hold a
"current session" implicitly; that would make multi-host processes unsafe.

## Failure and compatibility

- The migration is additive (schema v7): new tables, indexes and views only.
  `messages` and `deliveries` keep their shape, ids and foreign keys.
- Older readers ignore the group tables and continue to read direct messages.
  They do not see or acknowledge group deliveries; group features require an
  upgraded CLI or app. This is a feature gap, not a decode failure.
- The new `all_deliveries` view is the only read path that includes group
  deliveries; existing direct-only queries keep working unchanged.
- A store with no groups behaves exactly as today.
- Deleting a group is soft; history keeps the name and per-recipient chains.
  `group delete` does not rewrite member rows;
  `group show --group-id <id> --all` lists them.
  The same name may be reused by a new active group, which is why deleted
  groups are addressed by id.

## Phased implementation

1. Schema, group CRUD, membership, events and CLI group commands.
2. Group send with atomic fan-out, `group_deliveries`, the `all_deliveries`
   view and updated inbox/ack/wait/retry paths.
3. Group result/log DTOs and tests for left members, caps, empty groups and
   partial notification failure.
4. MCP server.
5. TypeScript SDK.
6. Real-host verification that a group notification is actually read by each
   host before claiming delivery beyond `notified`.

## Open questions

- Should groups be scoped to a project, a store, or a host pair? Start with
  store scope; project scope can be a filter later.
- Do subscriptions need filters (by sender, body or time) in v1? Start with
  membership as the only subscription; add filters only when a real workflow
  needs them.
- Should `group show` expose per-member last-seen and binding state, or leave
  that to `list`? Start with membership only and link to session ids.

## Capability claims

Groups add no host capability. `wakeup_level`, `busy_receive` and notification
support remain per session and still require real-host evidence. A successful
group fan-out proves only that AeChat stored deliveries; it does not prove any
host read them.
