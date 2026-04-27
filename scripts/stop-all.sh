#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

wait_for_pattern_exit() {
  local pattern="$1"
  local attempts="${2:-20}"
  local delay="${3:-0.25}"
  local i=1

  while [ "$i" -le "$attempts" ]; do
    if ! pgrep -f "$pattern" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done

  return 1
}

stop_pattern() {
  local pattern="$1"
  local label="$2"

  if ! pgrep -f "$pattern" >/dev/null 2>&1; then
    return 0
  fi

  echo "stop-all: encerrando ${label} com TERM."
  pkill -f "$pattern" >/dev/null 2>&1 || true
  if wait_for_pattern_exit "$pattern"; then
    return 0
  fi

  echo "stop-all: ${label} nao encerrou no tempo; escalando para KILL."
  pkill -9 -f "$pattern" >/dev/null 2>&1 || true
  wait_for_pattern_exit "$pattern" 20 0.25 || true
}

stop_pattern "pnpm --filter @querobroapp/api dev" "pnpm api dev"
stop_pattern "pnpm dev:web:published-local" "pnpm public mirror"
stop_pattern "node scripts/public-site-mirror.mjs" "public mirror"
stop_pattern "pnpm --filter @querobroapp/web dev:ops-local" "pnpm web ops-local"
stop_pattern "pnpm --filter @querobroapp/web dev" "pnpm web dev"
stop_pattern "tsx watch src/main.ts" "tsx watch API"
stop_pattern "next dev -H 127.0.0.1" "next dev"

"$ROOT_DIR/scripts/kill-ports.sh" || true

echo "Stopped dev servers and cleared ports."
