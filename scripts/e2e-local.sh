#!/usr/bin/env bash
#
# Local transport E2E: two isolated AeChat sessions over a real agmsg team.
#
# This proves session registration, host-role binding, durable send, inbox,
# ack, reply, wait and the audit chain. It does not prove that a model in a
# host conversation read or answered the message; that requires the manual
# host protocol in docs/e2e.md.
#
# Requires: pnpm build, agmsg 1.7.1, jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/dist/cli/main.js"
AGMSG_DIR="${AGMSG_HOME:-$HOME/.agents/skills/agmsg}"
STAMP="$(date +%s)-$$"
TEAM="${AECHAT_E2E_TEAM:-aechat-e2e-$STAMP}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/aechat-e2e.XXXXXX")"
KEEP="${KEEP:-0}"

mkdir -p "$WORK/home" "$WORK/project-a" "$WORK/project-b"

export AECHAT_HOME="$WORK/home"
export AECHAT_TEAM="$TEAM"

aechat() {
  node "$CLI" "$@"
}

fail() {
  echo "e2e: $*" >&2
  exit 1
}

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "e2e: kept $WORK"
    return
  fi
  "$AGMSG_DIR/scripts/team.sh" "$TEAM" \
    --delete --force --purge-messages --yes >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

[ -f "$CLI" ] || fail "dist/cli/main.js is missing; run pnpm build first"
command -v jq >/dev/null || fail "jq is required"
[ -x "$AGMSG_DIR/scripts/actas-claim.sh" ] || fail "agmsg scripts not found at $AGMSG_DIR"

# Register through the same host-session path a real Claude Code conversation
# uses: CLAUDE_CODE_SESSION_ID drives the actas claim, so no manual bind step.
register() {
  local name="$1" project="$2" host_sid="$3"
  AGMSG_SESSION_ID= CLAUDE_CODE_SESSION_ID="$host_sid" CODEX_THREAD_ID= \
    aechat register --name "$name" --client claude-code \
      --project "$project" --json
}

assert_auto_bound() {
  local label="$1" reg="$2"
  [ "$(jq -r '.data.binding_state' <<<"$reg")" = "bound" ] \
    || fail "session $label did not auto-bind: $reg"
  [ "$(jq -r '.data.bound_scope' <<<"$reg")" = "host_role" ] \
    || fail "session $label did not report host_role: $reg"
  [ "$(jq -r '.data.auto_bind.transportClaimState' <<<"$reg")" = "accepted" ] \
    || fail "session $label claim was not accepted: $reg"
  [ "$(jq -r '.data.bind_directive' <<<"$reg")" = "null" ] \
    || fail "session $label still returned a bind directive: $reg"
}

reg_a="$(register e2e-a "$WORK/project-a" "e2e-$STAMP-a")"
sid_a="$(jq -r '.data.session_id' <<<"$reg_a")"
assert_auto_bound A "$reg_a"

reg_b="$(register e2e-b "$WORK/project-b" "e2e-$STAMP-b")"
sid_b="$(jq -r '.data.session_id' <<<"$reg_b")"
assert_auto_bound B "$reg_b"

sent="$(aechat send --session "$sid_a" --to-session "$sid_b" \
  --request --deadline 300 --body "e2e request $STAMP" --json)"
message_id="$(jq -r '.data.message_id' <<<"$sent")"
send_status="$(jq -r '.data.status' <<<"$sent")"

inbox="$(aechat inbox --session "$sid_b" --json)"
token="$(jq -r '.data.messages[0].delivery_token' <<<"$inbox")"
request_id="$(jq -r '.data.messages[0].request_id' <<<"$inbox")"
[ "$request_id" = "$message_id" ] || fail "inbox returned the wrong request"

aechat ack --session "$sid_b" --delivery "$token" --json >/dev/null
aechat reply --session "$sid_b" --request "$request_id" \
  --body "e2e reply $STAMP" --json >/dev/null
waited="$(aechat wait --session "$sid_a" --request "$request_id" \
  --timeout 10 --json)"
[ "$(jq -r '.data.status' <<<"$waited")" = "replied" ] \
  || fail "wait did not observe the reply: $waited"
[ "$(jq -r '.data.message.body' <<<"$waited")" = "e2e reply $STAMP" ] \
  || fail "wait returned the wrong body"

chain="$(aechat log --message "$message_id" --json)"
events="$(jq -c '[.data.chain[].event]' <<<"$chain")"
for event in send inbox_claim ack reply; do
  jq -e --arg event "$event" '.data.chain[] | select(.event == $event)' \
    <<<"$chain" >/dev/null || fail "audit chain is missing $event"
done

aechat leave --session "$sid_b" --json >/dev/null
aechat leave --session "$sid_a" --json >/dev/null

summary="$(jq -n \
  --arg team "$TEAM" \
  --arg session_a "$sid_a" \
  --arg session_b "$sid_b" \
  --arg send_status "$send_status" \
  --argjson chain "$events" \
  '{team: $team, sessions: {a: $session_a, b: $session_b},
    binding: "host_role", auto_bind: true, send_status: $send_status,
    request: "replied", audit_chain: $chain,
    notification: (if $send_status == "notified" then "pushed" else "pull-only" end)}')"

mkdir -p "$ROOT/reports"
printf '%s\n' "$summary" | tee "$ROOT/reports/e2e-local.json"
echo "e2e: PASS (transport, auto-bind, request/reply, audit, leave)"
