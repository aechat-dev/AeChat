#!/usr/bin/env bash
# Fail unless the given commit is reachable from origin/main.
# Usage: verify-tag-on-main.sh <commit>
set -euo pipefail

commit=${1:?usage: verify-tag-on-main.sh <commit>}

# A shallow fetch would truncate origin/main to its tip and reject tags on
# older main commits, so this must stay a full fetch.
git fetch origin main

if ! git merge-base --is-ancestor "$commit" origin/main; then
  echo "release tags must point at a commit on main" >&2
  exit 1
fi
