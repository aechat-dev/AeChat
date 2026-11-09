#!/usr/bin/env bash
# Create or resume a draft GitHub release, upload every asset, then publish.
# Re-running after a failed upload resumes the existing draft instead of
# failing on "release already exists".
# Usage: publish-release.sh <tag> <notes-file> <asset>...
set -euo pipefail

tag=${1:?usage: publish-release.sh <tag> <notes-file> <asset>...}
notes=${2:?usage: publish-release.sh <tag> <notes-file> <asset>...}
shift 2
[ $# -gt 0 ] || { echo "no release assets given" >&2; exit 2; }

view_err=$(mktemp "${TMPDIR:-/tmp}/aechat-release-view.XXXXXX")
trap 'rm -f "$view_err"' EXIT
if state=$(gh release view "$tag" --json isDraft --jq '.isDraft' 2>"$view_err"); then
  :
else
  if grep -q "release not found" "$view_err"; then
    state="missing"
  else
    cat "$view_err" >&2
    exit 1
  fi
fi

case "$state" in
  true)
    echo "Resuming draft release $tag"
    edit=(--title "AeChat $tag" --notes-file "$notes")
    if [[ "$tag" == *-* ]]; then
      edit+=(--prerelease)
    fi
    gh release edit "$tag" "${edit[@]}"
    ;;
  false)
    echo "release $tag is already published" >&2
    exit 1
    ;;
  missing)
    # Keep one non-empty argument list: macOS ships Bash 3.2, where expanding
    # an empty array under `set -u` aborts with "unbound variable".
    args=(--draft --title "AeChat $tag" --notes-file "$notes")
    if [[ "$tag" == *-* ]]; then
      args+=(--prerelease)
    fi
    gh release create "$tag" "${args[@]}"
    ;;
  *)
    echo "unexpected release state for $tag: $state" >&2
    exit 1
    ;;
esac

gh release upload "$tag" "$@" --clobber
gh release edit "$tag" --draft=false
