#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$HOME/querobroapp"
STATE_DIR="$HOME/.querobroapp"
REFRESH_SCRIPT="$SCRIPT_DIR/refresh-codex-context.sh"
SNAPSHOT_PATH="$STATE_DIR/codex-auto-session-snapshot.md"

cd "$REPO_DIR"

CODEX_CONTEXT_STATE_DIR="$STATE_DIR" \
CODEX_CONTEXT_OUT_FILE="$SNAPSHOT_PATH" \
  bash "$REFRESH_SCRIPT" >/dev/null

echo "=== QUEROBROAPP RELEARN CONTEXT ==="
echo "Repo: $REPO_DIR"
echo "Snapshot: $SNAPSHOT_PATH"
echo

sed -n '1,220p' "$SNAPSHOT_PATH"
echo
echo "=== LEITURA COMPLEMENTAR MINIMA ==="
echo "- docs/NEXT_STEP_PLAN.md"
echo "- ultimas 80 linhas de docs/HANDOFF_LOG.md"
