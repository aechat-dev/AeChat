#!/bin/sh
# Locate node and hand the hook payload to session-start.mjs. Codex desktop
# sessions can inherit a minimal PATH, so a bare `node` in hooks.json is not
# reliable; search the usual install roots before giving up.
umask 077

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 0
log_dir=${AECHAT_HOME:-$HOME/.aechat}/logs

log() {
  mkdir -p "$log_dir" 2>/dev/null || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" \
    >>"$log_dir/codex-session-start.log" 2>/dev/null || true
}

node_bin=
if command -v node >/dev/null 2>&1; then
  node_bin=$(command -v node)
fi
if [ -z "$node_bin" ]; then
  for candidate in \
    "$HOME"/.local/state/fnm_multishells/*/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    if [ -x "$candidate" ]; then
      node_bin=$candidate
      break
    fi
  done
fi
if [ -z "$node_bin" ]; then
  log "skip: node not found"
  exit 0
fi

exec "$node_bin" "$root/session-start.mjs"
