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
| Register two isolated sessions | ✅ 2026-11-08 | ◐ 2026-11-09 (one Codex + peer) | `pnpm e2e:local`; Codex host run |
| Automatic binding from the host session | ✅ 2026-11-08 | ◐ 2026-11-09 claim accepted, not bound | `pnpm e2e:local`; Codex host run |
| Bind with `bound_scope=host_role` | ✅ 2026-11-08 | ? confirm not run; `bound_scope=none` | `pnpm e2e:local`; Codex claim stale |
| Host initiates a request and waits for the reply | ✅ 2026-11-08 | ? | Host run, 2026-11-08 |
| Durable send + pull (`inbox`) | ✅ 2026-11-08 | ✅ 2026-11-09 | `pnpm e2e:local`; Codex receive |
| Request → ack → reply → `wait` | ✅ 2026-11-08 | ✅ 2026-11-09 | `pnpm e2e:local`; Codex host run |
| Audit chain (`send` → `inbox_claim` → `ack` → `reply`) | ✅ 2026-11-08 | ✅ 2026-11-09 | `pnpm e2e:local`; Codex host run |
| Leave and release | ✅ 2026-11-08 | ◐ 2026-11-09 sessions left, binding not re-checked | `pnpm e2e:local`; Codex host run |
| Host model reads and replies (manual turn) | ✅ 2026-11-08 (headless turn, pull) | ✅ 2026-11-09 (headless turn, pull) | Host runs |
| Push notification (`notification_receive`) | ? requires host hook | ◐ 2026-11-09 agmsgd notice reached the desktop thread | See the 2026-11-09 agmsgd evidence |
| Message body injected as a user turn | ◐ `aechat watch` JSONL events | ✅ 2026-11-09 `codex queue` direct injection | See the 2026-11-09 direct-injection evidence |
| Busy receive (`busy_receive`) | ? | ? | Phase 0 saw injection, no reply |
| Idle wakeup (`idle_wakeup`) | ◐ agmsg Monitor only, 2026-11-06 | ? | Not managed by AeChat; re-arm untested |
| Resume / rebind across host restarts | ? | ? | Unit tests only |
| Conversation-level binding | ✗ v1 reports `host_role` | ✗ | No host conversation ID capture |

## Evidence log

### 2026-11-09 — Codex direct body injection

- `aechat send` from this Claude Code session to `codex-main`
  (`01a1bf39-…`) returned `status=notified` at 12:12:53Z.
- The message was injected with the desktop app's own queue
  (`codex queue --thread 01a1aeb5-… --message=<body>`), not an agmsg pointer.
- The thread rollout records it as `"role":"user"` with
  `provenance: user`; the user confirmed it appears as a normal user message
  in the Codex desktop conversation and that no `[agmsg:…]` notice appeared.
  Codex ran a turn and answered, so direct injection drives a turn.
- Injected text carries one header line (`[AeChat] message=<id> kind=<kind>
  from=<name>`); `kind` is `notify`, `request` or `reply`. Requests add
  `request=<id>` and the reply command; replies add `reply=<request id>`.
- Request E2E: `aechat send --request` was injected directly into the desktop
  thread (`01a1c059-…`), Codex answered with `aechat reply`, and the sender's
  `aechat wait --request` completed with `status=replied`. Codex also sent a
  standalone `aechat send` notification (`01a1c05a-…`), which arrived as
  `delivery_status=delivered`.
- Bodies beginning with `-` are passed as `--message=<body>`, never as a
  separate argv option.
- Conversation id is the thread UUID recorded on the AeChat session; without
  it, or when the Codex CLI is unavailable, notify fails instead of silently
  falling back to the pull pointer.
- Delivery records `direct_attempted` before queueing, so a timeout after
  enqueue is not retried and cannot duplicate the user turn.

### 2026-11-09 — Codex desktop agmsgd notice and request/reply

- Host: Codex desktop (ChatGPT.app, bundled `codex-cli 0.167.0-alpha.3.2`),
  agmsg 1.7.1, macOS. AeChat sessions: this Claude Code session and a Codex
  desktop conversation in project `研究计划`.
- agmsgd was turned on for the Codex project (`this project: agmsgd`). The
  first attempts failed with `queue_exit_127` because agmsgd's recorded
  `meta.codex_path` pointed at a terminal shim; it was corrected by hand to the
  CLI bundled inside ChatGPT.app. This is an environment repair, not a code
  path exercised by AeChat yet.
- With that path, `agmsgd` recorded `sent / accepted` and the Codex desktop
  conversation received `[agmsg:<nonce>] New messages are waiting` and started
  a model turn with no manual `receive`.
- The turn read the agmsg inbox and the `[AeChat] msg=...` pointer but did not
  invoke the aechat skill. After a human wrote "use the aechat skill ..." in the
  conversation, Codex ran `receive → ack → reply`; the sender's chain was
  `stored → notified → delivered → acked → replied` with reply `codex-ok`.
- Caveat: automatic transport delivery only. Skill invocation and message
  injection still required a human prompt (issues #62, #63). No claim is made
  for terminal `codex` under agmsgd, or for automatic reply without a human.

### 2026-11-09 — Codex headless pull and reply

- Host: Codex CLI 0.167.0-alpha.3.2, configured model `gpt-5.6-sol`,
  agmsg 1.7.1, Node 24, macOS.
- Isolated `AECHAT_HOME` and temporary agmsg team. A peer session sent a
  request while a single `codex exec` turn ran in a sandboxed project.
- The turn ran `aechat register --client codex` and read `CODEX_THREAD_ID`
  (`01a1befe-f26c-7e51-8441-77fb8b63c7ea`), then `receive` returned
  `status=delivered`; the host acknowledged and replied `codex-e2e-ok`. The
  peer's `wait` returned `replied`, and the audit chain was
  `send → inbox_claim → ack → send → reply`.
- Binding: `transportClaimState=accepted` but `claimed=false`,
  `bound_scope=none`, `bound_state=invalid`, transport `dead`. `aechat
  confirm` was not run, so no `host_role` claim is made for Codex.
- After the turn, both `aechat leave` calls ran; `list --all` reports both
  sessions as `status=left`. The agmsg team was deleted immediately after, so
  transport-side binding release was not re-checked.
- Skill loading initially failed: Codex requires YAML frontmatter in
  `SKILL.md`. Frontmatter was added after the run; the turn followed the
  explicit commands rather than a loaded skill.
- Environment note: the Codex shell policy inherits only `core` by default;
  the run passed `-c shell_environment_policy.inherit=all` to expose
  `AECHAT_HOME` and `AECHAT_TEAM` to the turn.
- Caveat: a user-triggered headless turn, not idle wakeup or busy receive.
- Not run: idle wakeup, busy receive, Codex-initiated request, resume,
  conversation-level binding.

### 2026-11-08 — Claude Code auto-bind and outbound request

- Host: Claude Code CLI 2.1.319, agmsg 1.7.1, Node 24, macOS.
- A headless `claude -p` turn ran `aechat register` inside an isolated
  `AECHAT_HOME` and temporary agmsg team. Registration read
  `CLAUDE_CODE_SESSION_ID`, claimed the role and returned
  `binding_state=bound`, `bound_scope=host_role`,
  `transportClaimState=accepted` and `bind_directive=null`.
- The host then sent a request to a peer, the peer acknowledged and replied,
  and the host's `wait` returned `replied` with body `peer-reply-ok`.
- Caveat: a user-triggered headless turn, not idle wakeup or busy receive. The
  harness reported its model id as unrecognized, so this proves the host path,
  not a specific Claude model version.
- Not run: Codex, idle wakeup, busy receive.

### 2026-11-08 — Claude Code host turn

- Host: Claude Code CLI 2.1.319, agmsg 1.7.1, macOS.
- The session was bound with `host_role` in an isolated project and answered a
  request sent by a second session. The turn was a controlled headless
  `claude -p` run, not an idle wakeup.
- Result: the host read the request with `aechat inbox`, acknowledged the
  delivery and replied `host-e2e-ok`; the peer's `wait` returned `replied` and
  the audit chain was `send → send → inbox_claim → ack → reply`.
- Caveat: the harness reported its model id as unrecognized, so this run proves
  the Claude Code host path, not a specific Claude model version.
- Not run: idle wakeup, busy receive, Codex.

### 2026-11-08 — local transport E2E

- Command: `pnpm build && pnpm e2e:local`
- Environment: macOS, Node 24.21.0, agmsg 1.7.1, two `claude-code` identities
  in an isolated `AECHAT_HOME` and temporary agmsg team.
- Result: two sessions auto-bound from `CLAUDE_CODE_SESSION_ID` with
  `host_role`; request/reply completed; audit chain
  `send → send → inbox_claim → ack → reply`; both sessions left cleanly.
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
