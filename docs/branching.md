# Branches, CI and releases

AeChat separates integration from release verification. Feature work lands on
`dev`; `main` carries reviewed, stable commits and release tags.

## Current state (2026-11-08)

`main` and `dev` both exist on origin. `main` requires a pull request (zero
approvals), the `TypeScript` and `macOS app` checks, an up-to-date branch and
conversation resolution; force pushes and deletions are blocked and
`enforce_admins` is on. `dev` requires a pull request and `TypeScript`; force
pushes and deletions are blocked. The branch model and CI below are the
operating rules.

## Branch model

| Branch | Purpose | Changes arrive by |
| --- | --- | --- |
| `main` | Stable line and release source | Pull request from `dev` (team policy) |
| `dev` | Integration line | Feature/fix pull requests |
| `feature/*` | Short-lived work | Pull request into `dev` |

Do not commit directly to `main`, force-push it, or delete it. The same rules
apply to administrators once `enforce_admins` is enabled.

"Only `dev` opens pull requests into `main`" is a team policy: standard branch
protection cannot restrict the head branch of a pull request.

## CI

- `.github/workflows/ci.yml` — `TypeScript`: typecheck, lint, test audit,
  coverage and build. Runs on every pull request and on pushes to `main` and
  `dev`.
- `.github/workflows/macos.yml` — `macOS app`: Swift format, build, checks,
  packaging and signature verification. Runs on pull requests into `main`, on
  pushes to `dev`, nightly on the default branch, and manually.

Feature pull requests into `dev` get the fast TypeScript gate only. Release
pull requests from `dev` into `main` also run the macOS job, so the artifact
and signature are verified before the merge.

## Repository settings

These settings live in GitHub, not in the repository. They were applied to the
upstream repository on 2026-11-08. For a fork or a new repository, apply them
in this order so a required check always exists on the base branch:

1. Bootstrap once: push `dev` at the current commit, open the first
   `dev` → `main` pull request, and merge it after the `TypeScript` check
   passes. Do not require `macOS app` for this pull request: the base branch
   has no `macos.yml` yet. A direct administrator push of the same commit is
   equivalent, but bypasses the intended policy.
2. With `macos.yml` on `main`, enable the protection rules below, including
   `macOS app` and `enforce_admins`.
3. From then on, feature pull requests target `dev`; release pull requests go
   `dev` → `main` and run both checks.

Requiring `macOS app` before the workflow is on `main` would block every
release pull request, because `pull_request` workflows are loaded from the
base branch.

- Default branch: `main`.
- `main` protection:
  - require a pull request before merging;
  - require the `TypeScript` and `macOS app` checks;
  - require branches to be up to date before merging;
  - require conversation resolution;
  - block force pushes and deletions;
  - enable `enforce_admins`.
- `dev` protection:
  - require a pull request and the `TypeScript` check;
  - block force pushes and deletions.

`enforce_admins` is on for `main`, so administrators cannot bypass its rules.
For `dev` it is off: administrators can still push directly during a bootstrap,
while regular contributors must use a pull request.

## Release steps

Releases are tagged from `main` after the release pull request is merged:

```bash
git switch main
git pull --ff-only
git tag -a v0.1.0-alpha.1 -m "AeChat v0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

Tagging, artifact publication and release notes are owned by the release work
tracked in issue #12. Do not create a release tag from `dev` or from a feature
branch.
