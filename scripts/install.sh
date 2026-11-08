#!/usr/bin/env bash
# Install the AeChat CLI from a GitHub release tarball.
# Usage: bash install.sh [--version <tag>] [--stable] [--prefix <dir>] [--dry-run]
set -euo pipefail

repo="aechat-dev/AeChat"
version=""
channel="newest"
prefix=""
dry_run=false

usage() {
  cat <<'EOF'
Usage: install.sh [options]

  --version <tag>  Install a specific release tag (for example v0.1.0-alpha.1)
  --stable         Install the newest non-prerelease instead of the newest
  --prefix <dir>   Install under <dir> instead of the global npm prefix
  --dry-run        Resolve and print the install plan without changing anything
  -h, --help       Show this help

Requires macOS, Node.js 24 or newer, npm and curl.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || { echo "--version requires a value" >&2; exit 2; }
      version=$2
      shift 2
      ;;
    --stable)
      channel="stable"
      shift
      ;;
    --prefix)
      [ $# -ge 2 ] || { echo "--prefix requires a value" >&2; exit 2; }
      prefix=$2
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$version" ]; then
  for command in curl node; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "missing required command: $command" >&2
      exit 1
    }
  done
  api="https://api.github.com/repos/$repo/releases?per_page=20"
  release_json=$(curl -fsSL -H "Accept: application/vnd.github+json" "$api") || {
    echo "could not list releases from GitHub" >&2
    exit 1
  }
  version=$(printf '%s' "$release_json" | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      const releases = JSON.parse(body);
      const stable = process.argv[1] === "stable";
      const match = releases.find((item) =>
        !item.draft && (stable ? !item.prerelease : true)
      );
      if (!match) process.exit(1);
      process.stdout.write(match.tag_name);
    });
  ' "$channel") || {
    echo "no matching release found for channel: $channel" >&2
    exit 1
  }
fi

case "$version" in
  v*) tag=$version ;;
  *) tag="v$version" ;;
esac
number=${tag#v}
asset="aechat-$number.tgz"
base="https://github.com/$repo/releases/download/$tag"

if [ "$dry_run" = true ]; then
  echo "tag: $tag"
  echo "tarball: $base/$asset"
  echo "checksums: $base/SHA256SUMS"
  if [ -n "$prefix" ]; then
    echo "install: npm install -g --prefix $prefix $asset"
  else
    echo "install: npm install -g $asset"
  fi
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "AeChat currently supports macOS only" >&2
  exit 1
fi

for command in curl node npm shasum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 1
  }
done

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 24 ]; then
  echo "Node.js 24 or newer is required; found $(node -v)" >&2
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/aechat-install.XXXXXX")
trap 'rm -rf "$work"' EXIT

echo "Downloading AeChat $tag"
curl -fsSL "$base/$asset" -o "$work/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS"
(cd "$work" && shasum -a 256 -c SHA256SUMS)

if [ -n "$prefix" ]; then
  npm install -g --prefix "$prefix" "$work/$asset"
  bin="$prefix/bin/aechat"
else
  npm install -g "$work/$asset"
  bin="$(npm prefix -g)/bin/aechat"
fi

if [ ! -x "$bin" ]; then
  echo "installed, but could not find the aechat binary at $bin" >&2
  exit 1
fi
"$bin" --help >/dev/null

echo
echo "Installed AeChat $tag"
echo "Next: aechat init && aechat doctor --json"
echo "Then register each agent conversation with:"
echo "  aechat register --name \"<name>\" --client claude-code --project \"\$PWD\""
echo "  aechat register --name \"<name>\" --client codex --project \"\$PWD\""
