#!/usr/bin/env bash
set -euo pipefail

tag=${1:?usage: release-notes.sh <tag> [changelog]}
changelog=${2:-CHANGELOG.md}
version=${tag#v}

if [ ! -f "$changelog" ]; then
  echo "missing changelog: $changelog" >&2
  exit 1
fi

notes=$(
  awk -v version="$version" '
    index($0, "## [" version "]") == 1 { inside = 1; next }
    inside && index($0, "## [") == 1 { exit }
    inside { print }
  ' "$changelog"
)

if [ -z "${notes//[[:space:]]/}" ]; then
  echo "no changelog section for $version" >&2
  exit 1
fi

printf '%s\n' "$notes"
