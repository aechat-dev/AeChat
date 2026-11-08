# End-to-end verification

AeChat has two E2E layers. Run the automated layer on every release candidate;
run the host layer before claiming host support.

## 1. Automated transport E2E

```bash
pnpm build
pnpm e2e:local
```

The script creates an isolated `AECHAT_HOME` and a temporary agmsg team, then:

1. registers two `claude-code` identities;
2. binds both with a live actas claim and confirms `bound_scope=host_role`;
3. sends a request, pulls it, acknowledges it, replies and waits for the reply;
4. asserts the audit chain and leaves both sessions;
5. writes `reports/e2e-local.json` and deletes the temporary team.

It requires `agmsg` 1.7.1, `jq` and a macOS shell. It does **not** install host
hooks and does not claim a model processed the message. `send_status=stored`
is expected in this mode; delivery is pull-only.

Failure means the transport foundation is broken. Do not run host tests on top
of a failing local suite.

## 2. Manual host E2E

Use this for a real Claude Code or Codex conversation. Work in a temporary
project and an isolated AeChat home so the run cannot touch real sessions.

### Prepare

```bash
export AECHAT_HOME="$(mktemp -d)/home"
export AECHAT_TEAM="aechat-e2e-$(date +%s)"
mkdir -p "$AECHAT_HOME" /tmp/aechat-host-test

# Install the skill into the test project, not the user's global config.
mkdir -p /tmp/aechat-host-test/.claude/skills/aechat
cp skills/claude-code/SKILL.md /tmp/aechat-host-test/.claude/skills/aechat/SKILL.md
```

For Codex, copy `skills/codex/SKILL.md` to the project's skill directory and
record the Codex CLI version. Codex host tests are blocked until the usage
limit resets (2026-11-09 13:51 on the current machine).

### Run

1. In the host conversation, register:
   `aechat register --name host-a --client claude-code --project <project>`
2. Run the returned bind directive in that conversation.
3. Confirm from the shell: `aechat confirm --session <host_a_id>`.
4. From a second session, send a request:
   `aechat send --session <peer_id> --to-session <host_a_id> --request --deadline 300 --body "e2e: reply with host-e2e-ok"`
5. Observe the host without giving it another user message.
6. Record which happened:
   - **L0** — the host did nothing until someone ran `inbox`.
   - **L1** — a blocking `wait` was the only delivery path.
   - **L2** — the host was busy, saw the message, and answered.
   - **L3** — the idle host started a turn and answered on its own.
7. Verify the answer came from the model, not from a hook:
   `aechat log --message <request_id> --json` must show `ack` and `reply`.
8. Leave both sessions and delete the temporary team.

### Evidence to record

- date and host CLI version;
- agmsg version and delivery mode;
- `bound_scope` and binding state;
- whether the host was idle, busy or in a Monitor window;
- the request, reply and audit chain;
- what was **not** run.

Do not infer wakeup from a successful bind, a hook install or an agmsg
subscription. Only an `ack` or `reply` proves the host processed the message.

## Recording results

Update [compatibility.md](compatibility.md) in the same pull request. A cell
may move to ✅ only with a dated run and the exact condition; a contradiction
must downgrade the cell, not be averaged away.
