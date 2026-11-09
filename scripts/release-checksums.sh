#!/usr/bin/env bash
# Print SHA256SUMS entries for release assets using their published
# basenames. Release downloads are flat, so build paths must not leak in.
set -euo pipefail

for file in "$@"; do
  digest=$(shasum -a 256 "$file" | awk '{ print $1 }')
  printf '%s  %s\n' "$digest" "$(basename "$file")"
done
