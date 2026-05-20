#!/bin/bash
# Wrapper der køres af LaunchAgent'en dk.edc.topdesk-devops-sync.
# Finder node (foretrækker Homebrew / nvm) og starter scripts/daily-sync.mjs
# med projektets rod som CWD. Skriver til ~/Library/Logs/edc-topdesk-sync/.

set -euo pipefail

PROJECT_DIR="/Users/matiasgramkow/Development/edc-devops-service"
LOG_DIR="$HOME/Library/Logs/edc-topdesk-sync"
mkdir -p "$LOG_DIR"

# Find node — LaunchAgents starter uden brugerens shell-profil, så vi må
# selv finde en fungerende node-binary.
find_node() {
  # 1) Eksplicit override
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    echo "$NODE_BIN"; return
  fi
  # 2) Homebrew (Apple Silicon + Intel)
  for p in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$p" ] && echo "$p" && return
  done
  # 3) Standard PATH
  if command -v node >/dev/null 2>&1; then
    command -v node; return
  fi
  # 4) nvm — kør i en login-shell så .zshrc/.bash_profile loader nvm
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # Brug version fra .nvmrc hvis den findes, ellers default
    NODE_PATH=$(/bin/bash -lc "source \"$HOME/.nvm/nvm.sh\" && cd \"$PROJECT_DIR\" && (nvm use --silent 2>/dev/null || true) && command -v node" 2>/dev/null || true)
    if [ -n "$NODE_PATH" ] && [ -x "$NODE_PATH" ]; then
      echo "$NODE_PATH"; return
    fi
  fi
  return 1
}

NODE="$(find_node || true)"
if [ -z "${NODE}" ]; then
  echo "[$(date -Iseconds)] FATAL: kunne ikke finde node" >> "$LOG_DIR/error.log"
  exit 127
fi

cd "$PROJECT_DIR"
exec "$NODE" "$PROJECT_DIR/scripts/daily-sync.mjs" "$@"
