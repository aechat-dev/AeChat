# Changelog

All notable changes to AeChat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

AeChat is pre-1.0; interfaces may change between minor releases. Do not edit
this file in a pull request unless the change is user-visible. Release notes
are assembled from the `Unreleased` section at tag time.

## [Unreleased]

### Added

- Session-scoped messaging CLI: registration, discovery, send, inbox, ack,
  reply, wait, heartbeat, cancel, retry, resume and leave.
- agmsg transport adapter with explicit binding confirmation and honest
  capability reporting; no automatic wakeup claim without real-host evidence.
- Message, delivery and request state machines backed by SQLite, with an
  append-only audit event for every lifecycle transition.
- Structured audit queries (`aechat log`, `aechat history`) with secret and
  path redaction.
- Read-only macOS SwiftUI monitor built on the `ui-*` bridge: overview,
  sessions, chat timeline, request cards, inspector and live event stream.
- Product icon for the app bundle and README.
- Host skill templates for Claude Code and Codex.
- Repository quality gates: Biome lint/format, `swift-format`, test audit,
  coverage floors and CI on Linux and macOS.
- Local transport E2E harness (`pnpm e2e:local`) and a dated host compatibility
  matrix with a repeatable manual protocol.
- `aechat init` and `aechat setup <host>`: create the store, check agmsg and
  install or refresh host skills.
- `aechat register` claims the binding from inside Claude Code or Codex
  automatically (`CLAUDE_CODE_SESSION_ID` / `CODEX_THREAD_ID`, with
  `AGMSG_SESSION_ID` overriding) and falls back to the bind directive when no
  claim succeeded and no role is held.

### Fixed

- Expiry, dead-letter and leave-cancellation transitions now emit per-message
  audit events in the same transaction as the state change, and `aechat log`
  orders the chain by time.

### Security

- Database files are created owner-only (0600).
- Audit error details are redacted before storage.
- The native app has no send, reply, acknowledge or delivery-claim path.
