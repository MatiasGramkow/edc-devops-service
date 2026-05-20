#!/bin/bash
# Installerer (eller geninstallerer) LaunchAgent'en der dagligt synkroniserer
# nye Topdesk-tickets til Azure DevOps work items.
#
# Kør én gang:
#   bash scripts/install-launchagent.sh
#
# Afinstallér:
#   bash scripts/install-launchagent.sh --uninstall

set -euo pipefail

LABEL="dk.edc.topdesk-devops-sync"
PLIST_SRC="$(cd "$(dirname "$0")" && pwd)/${LABEL}.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/edc-topdesk-sync"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

if [ "${1:-}" = "--uninstall" ]; then
  if [ -f "$PLIST_DEST" ]; then
    launchctl unload -w "$PLIST_DEST" 2>/dev/null || true
    rm -f "$PLIST_DEST"
    echo "Afinstalleret: $PLIST_DEST"
  else
    echo "Ingen LaunchAgent fundet på $PLIST_DEST"
  fi
  exit 0
fi

# Idempotent: unload den eksisterende først hvis den allerede ligger der
if [ -f "$PLIST_DEST" ]; then
  launchctl unload -w "$PLIST_DEST" 2>/dev/null || true
fi

cp "$PLIST_SRC" "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
launchctl load -w "$PLIST_DEST"

echo "✓ LaunchAgent installeret: $PLIST_DEST"
echo "  Næste kørsel: hverdage kl. 09:00 lokal tid"
echo "  Logs: $LOG_DIR/stdout.log + stderr.log"
echo
echo "Tjek status:"
echo "  launchctl list | grep ${LABEL}"
echo
echo "Test-kør nu (uden at skrive til DevOps):"
echo "  node scripts/daily-sync.mjs --dry-run"
echo
echo "Test-kør nu (skriver til DevOps for nye tickets siden sidste kørsel):"
echo "  node scripts/daily-sync.mjs"
