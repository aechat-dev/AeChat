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
  if [ "$channel" = "stable" ]; then
    api="https://api.github.com/repos/$repo/releases/latest"
    release_json=$(curl -fsSL -H "Accept: application/vnd.github+json" "$api") || {
      echo "could not read the latest stable release from GitHub" >&2
      exit 1
    }
    version=$(printf '%s' "$release_json" | node -e '
      let body = "";
      process.stdin.on("data", (chunk) => { body += chunk; });
      process.stdin.on("end", () => {
        const release = JSON.parse(body);
        if (!release.tag_name || release.draft || release.prerelease) process.exit(1);
        process.stdout.write(release.tag_name);
      });
    ') || {
      echo "no stable release found" >&2
      exit 1
    }
  else
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
        const match = releases.find((item) => !item.draft);
        if (!match) process.exit(1);
        process.stdout.write(match.tag_name);
      });
    ') || {
      echo "no release found" >&2
      exit 1
    }
  fi
fi

case "$version" in
  v*) tag=$version ;;
  *) tag="v$version" ;;
esac
number=${tag#v}
case "$number" in
  ""|*..*|*[!0-9A-Za-z.+-]*)
    echo "invalid release version: $version" >&2
    exit 2
    ;;
esac
case "$number" in
  [0-9]*) ;;
  *)
    echo "invalid release version: $version" >&2
    exit 2
    ;;
esac
asset="aechat-$number.tgz"
base="${AECHAT_INSTALL_BASE:-https://github.com/$repo}/releases/download/$tag"
if [ -n "${AECHAT_INSTALL_BASE:-}" ]; then
  command -v node >/dev/null 2>&1 || {
    echo "missing required command: node" >&2
    exit 1
  }
  # Parse the URL rather than pattern-matching: string prefixes accept
  # userinfo tricks such as http://127.0.0.1:80@example.invalid, which curl
  # resolves to example.invalid.
  if ! printf '%s' "$AECHAT_INSTALL_BASE" | node -e '
    let body = "";
    process.stdin.on("data", (chunk) => { body += chunk; });
    process.stdin.on("end", () => {
      let url;
      try {
        url = new URL(body);
      } catch {
        process.exit(1);
      }
      if (url.username || url.password) process.exit(1);
      if (url.protocol === "https:") process.exit(0);
      const loopback = ["127.0.0.1", "localhost", "[::1]"];
      if (
        process.env.AECHAT_INSTALL_ALLOW_INSECURE === "1" &&
        url.protocol === "http:" &&
        loopback.includes(url.hostname)
      ) {
        process.exit(0);
      }
      process.exit(1);
    });
  '; then
    echo "AECHAT_INSTALL_BASE must use HTTPS (loopback HTTP requires AECHAT_INSTALL_ALLOW_INSECURE=1)" >&2
    exit 2
  fi
fi

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

for command in curl shasum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "missing required command: $command" >&2
    exit 1
  }
done

work=$(mktemp -d "${TMPDIR:-/tmp}/aechat-install.XXXXXX")
trap 'rm -rf "$work"' EXIT

echo "Downloading AeChat $tag"
curl -fsSL "$base/$asset" -o "$work/$asset"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS"

# Fail closed: the checksum file must name this tarball exactly once, and the
# digest must match. `shasum -c` alone would pass a file that lists other
# artifacts and silently skip the one being installed.
count=$(
  awk -v name="$asset" '$2 == name { count += 1 } END { print count + 0 }' \
    "$work/SHA256SUMS"
)
if [ "$count" -ne 1 ]; then
  echo "SHA256SUMS must list $asset exactly once (found $count)" >&2
  exit 1
fi
expected=$(
  awk -v name="$asset" '$2 == name { print $1 }' "$work/SHA256SUMS"
)
actual=$(shasum -a 256 "$work/$asset" | awk '{ print $1 }')
if [ "$expected" != "$actual" ]; then
  echo "checksum mismatch for $asset" >&2
  exit 1
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

if [ -n "$prefix" ]; then
  npm install -g --prefix "$prefix" "$work/$asset"
  bin="$prefix/bin/aechat"
  case ":$PATH:" in
    *":$prefix/bin:"*) ;;
    *) echo "Add $prefix/bin to PATH to run aechat" ;;
  esac
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
