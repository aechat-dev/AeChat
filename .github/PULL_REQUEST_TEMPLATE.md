## Summary

<!-- What problem does this solve, and what can a user or host do after it? -->

## Related issue

<!-- Fixes #1234, or "None". -->

## Changes

<!-- Key changes and affected layers. Keep unrelated work out. -->

## Testing

<!--
Separate what you added from what you ran. A test that exists but did not run
is not evidence.

Added:
- test name, what behavior it pins

Observed:
- `pnpm check` -> result
- command run -> actual output

Not run:
- what you only read or skipped, and why
-->

## Changelog

<!-- One user-visible line, or "none" for internal-only changes. -->

## Proof

<!-- Before/after screenshots or a short clip for UI changes. Otherwise say why not. -->

## Checklist

- [ ] The change is focused; unrelated work is in another pull request.
- [ ] Tests were added or updated, or Testing explains why not.
- [ ] `pnpm check` passes; Swift changes also pass `swift build`, `AeChatChecks` and `pnpm lint:swift`.
- [ ] Host capability and wakeup claims are limited to observed evidence.
- [ ] No secrets, personal paths, databases, logs or build output are included.
- [ ] Public behavior changes are reflected in README or `docs/`.
