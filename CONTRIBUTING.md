# Contributing to AeChat

Thanks for taking the time to contribute. AeChat is a local-first session
messaging service for AI agent hosts on macOS, with a read-only native monitor
app. The project is pre-1.0; interfaces may still change, but the layering and
audit guarantees below are considered stable.

## Before you start

- Read [docs/start-here.md](docs/start-here.md) for the repository map and the
  first commands to run.
- Read [README.md](README.md) for the product model and [docs/install.md](docs/install.md)
  for installation and host binding.
- Use [docs/contributor-verification.md](docs/contributor-verification.md) to
  choose the evidence a change needs.
- For anything larger than a bug fix, open an issue first so the design and the
  phase boundary can be agreed on before code is written.
- Report security issues privately, per [SECURITY.md](SECURITY.md). Do not open
  a public issue for a vulnerability.

## Requirements

- macOS 14 or newer (the native app and full check suite require macOS)
- Node.js 24 (`node:sqlite` is required)
- pnpm 11 (`corepack enable` or install pnpm 11.25.0)
- agmsg 1.7.1 on `PATH` for transport-level tests and manual verification
- Swift 6 toolchain (Xcode 16 or Command Line Tools). XCTest and Swift Testing
  are unavailable with Command Line Tools only, so the Swift checks are an
  executable target.

## Setup

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

The native app and its checks:

```bash
swift build --package-path apps/macos
swift run --package-path apps/macos AeChatChecks
./scripts/build-aechat-app.sh   # produces dist/AeChat.app
```

`AeChatChecks` is a development check target, not `swift test`. Do not describe
it as an XCTest or Swift Testing suite.

## Architecture boundaries

Keep the following split when adding code:

- `src/core` — domain, state machine, persistence, audit. No transport process
  handling and no CLI formatting.
- `src/adapters` — transport and host integration. New hosts are added as
  adapters; the core must not gain host-specific branches.
- `src/runtime` — composition and query services.
- `src/contracts` — JSON DTOs and envelopes shared with the UI bridge.
- `src/cli` — argument parsing and command wiring only.
- `apps/macos` — SwiftUI read-only monitor. It may call only the `ui-*` bridge
  commands. The app must never send, reply, acknowledge or claim deliveries.

The adapter interface is shared by first-party and third-party adapters. A new
host should require a new adapter, not a change to the messaging core.

## Logging and data

- Every message lifecycle transition must be observable in the `events` table:
  receive, persist, deliver, host read, reply. Add an event when the state
  changes.
- Redact secrets and local user paths from audit error details. Tests under
  `tests/core` cover redaction.
- Never commit a database, logs, build output, `.env` files or host credentials.

## Tests and quality gates

- Write the failing test first, watch it fail for the expected reason, then
  implement the smallest change that makes it pass.
- `pnpm check` runs every gate: typecheck, Biome lint/format, test audit and
  coverage. It must pass before a commit.
- `pnpm typecheck` must pass; do not suppress errors with `any` or unchecked
  casts.
- `pnpm lint` (Biome) enforces formatting and lint rules for TypeScript, JSON
  and scripts. Run `pnpm lint:fix` before committing.
- `pnpm test:audit` rejects committed `.only`, `.skip` and `.todo` tests.
  Skipped tests hide behavior that is no longer verified.
- `pnpm test:coverage` enforces the coverage floors: 75% statements, 65%
  branches, 85% functions, 75% lines. New behavior needs tests; do not lower a
  threshold to make a change pass without recording why.
- Changes to Swift code must pass `swift build`, `AeChatChecks` and
  `pnpm lint:swift` (swift-format with the repository config). Run
  `pnpm format:swift` to apply the formatter.
- Changes to packaging must pass `./scripts/build-aechat-app.sh` and
  `codesign --verify --deep --strict dist/AeChat.app`.

## Commits and pull requests

- Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`,
  `docs:`).
- One commit does one thing and can be reviewed and reverted independently.
  Do not mix unrelated changes.
- The commit body explains **why**, lists the key changes and the affected
  surface, and names the commands that were run.
- Pull requests should state the problem, the approach, the verification
  commands and their results, and any known limits. Link the issue when one
  exists.
- Keep pull requests focused. Large refactors and behavior changes should be
  split into reviewable phases.

## Branches, CI and releases

- `main` is the stable line and the only release source. It accepts pull
  requests from `dev`, never direct commits, force pushes or deletions.
- `dev` is the integration line. Feature and fix pull requests target `dev`.
- `TypeScript` runs on every pull request and on pushes to `main` and `dev`.
  `macOS app` runs on release pull requests into `main`, pushes to `dev`,
  nightly and manually. Feature pull requests stay on the fast TypeScript gate.
- Releases are tagged from `main` after the release pull request merges. The
  release process and artifact publication are tracked in issue #12.
- The full branch model, required checks and repository settings are in
  [docs/branching.md](docs/branching.md).

## Review

Changes are reviewed by a separate reviewer role. The reviewer checks the
change against the documented requirements, the adapter boundary and the audit
guarantees. Fixes are made by the author; the reviewer re-verifies. Review
notes are recorded with the change, not in the public history.

## License

By contributing, you agree that your contributions are licensed under the
MIT License in [LICENSE](LICENSE).
