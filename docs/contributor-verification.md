# Contributor verification

State what you actually ran. A green CI job whose tests were skipped is not
coverage, and a build that only compiled is not a host test.

## Evidence ladder

Pick the lowest rung that can fail for the reason your change could fail. Go
higher when the change crosses a process, a database or a host boundary.

| Level | Evidence | Proves |
|---|---|---|
| 0 | `pnpm typecheck` | Types are consistent |
| 1 | `pnpm test` for the touched module | Unit behavior |
| 2 | `pnpm check` | Lint, test audit and coverage floors |
| 3 | CLI or `ui-*` command against a temporary database | Persistence and JSON contract |
| 4 | Two real host conversations with agmsg | Delivery, binding and wakeup behavior |

`swift build`, `AeChatChecks` and `pnpm lint:swift` are required for Swift
changes. `./scripts/build-aechat-app.sh` plus
`codesign --verify --deep --strict dist/AeChat.app` are required for packaging
changes.

## Mapping changes to evidence

| Change | Minimum evidence |
|---|---|
| Pure refactor | 1 + 2, plus the tests covering the moved behavior |
| New CLI flag | 1 + 2 + a command run showing the output |
| Schema or migration | 1 + 2 + a test that opens the old schema and upgrades it |
| Delivery or request state | 1 + 2 + an audit chain assertion |
| UI bridge DTO | 1 + 2 + the actual `ui-*` JSON |
| SwiftUI behavior | `swift build` + `AeChatChecks`; window behavior stated as unverified if not observed |
| Host adapter | 1 + 2 + level 4, or an explicit statement that level 4 was not run |

## Real-host verification

For a wakeup or delivery claim, record:

- host and version,
- agmsg version and delivery mode,
- how the session was bound (`bound_scope`),
- what was sent, when, and what the host actually did,
- whether the observation was in a turn, idle, or during a Monitor window.

Do not generalize beyond the observation. Claude Code idle wakeup has been
observed only inside the Phase 0 Monitor lifetime. Codex automatic wakeup has
no model-turn evidence. `busy_receive` remains unknown. These limits stay in
the PR and in the docs until a new test changes them.

## Reporting in a pull request

Use `Observed` and `Not run` sections:

```text
Observed:
- pnpm check -> 37 files / 181 tests, coverage 77/67/89/77
- aechat send ... -> delivery stored, event chain send -> notify

Not run:
- Real Codex host; usage limit blocked the model turn
```

Keep test additions separate from test executions. Name the command. Do not
write "tests pass" without the command and its result.
