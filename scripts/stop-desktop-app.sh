#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

UID_VALUE="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
API_PLIST="$AGENTS_DIR/com.querobroapp.api.plist"
WEB_PLIST="$AGENTS_DIR/com.querobroapp.web.plist"

if [ -f "$API_PLIST" ]; then
  launchctl bootout "gui/$UID_VALUE" "$API_PLIST" >/dev/null 2>&1 || true
fi
if [ -f "$WEB_PLIST" ]; then
  launchctl bootout "gui/$UID_VALUE" "$WEB_PLIST" >/dev/null 2>&1 || true
fi

./scripts/stop-all.sh >/dev/null 2>&1 || true

echo "QUEROBROAPP encerrado."
