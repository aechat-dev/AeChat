#!/usr/bin/env bash
# Fail unless package.json matches the release tag.
# Usage: verify-package-version.sh <tag>
set -euo pipefail

tag=${1:?usage: verify-package-version.sh <tag>}
version=$(node -p "require('./package.json').version")

if [ "${tag#v}" != "$version" ]; then
  echo "tag $tag does not match package.json $version" >&2
  exit 1
fi
