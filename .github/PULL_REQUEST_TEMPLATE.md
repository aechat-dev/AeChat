## Summary

<!-- What problem does this change solve, and why now? -->

## Related issue

<!-- Link the issue or design discussion. Use "None" when there is no issue. -->

## Changes

<!-- List the key changes and the affected layers. -->

## Verification

<!-- Paste the commands and their results; do not only check the boxes. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `swift build --package-path apps/macos` (when Swift changes)
- [ ] `swift run --package-path apps/macos AeChatChecks` (when Swift changes)
- [ ] `./scripts/build-aechat-app.sh` (when packaging changes)

## Risks and rollback

<!-- Known limits, migration impact, or how to revert. -->

## Checklist

- [ ] The change is focused and does not mix unrelated work.
- [ ] I added or updated tests for the changed behavior.
- [ ] No database, logs, build output, credentials or personal data are included.
- [ ] Capability claims are limited to what has been verified in a real host.
