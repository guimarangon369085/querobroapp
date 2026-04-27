#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck source=./scripts/runtime-path.sh
source "$ROOT/scripts/runtime-path.sh"
setup_runtime_path

PNPM_BIN="$(command -v pnpm || true)"
if [ -z "$PNPM_BIN" ]; then
  echo "pnpm nao encontrado no PATH."
  exit 1
fi

DEV_ALL_PID=""
SHUTDOWN_DONE=0

wait_for_pid_exit() {
  local pid="$1"
  local attempts="${2:-40}"
  local delay="${3:-0.25}"
  local i=1

  [ -z "$pid" ] && return 0
  while [ "$i" -le "$attempts" ]; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done

  return 1
}

cleanup() {
  local exit_code=$?

  if [ "$SHUTDOWN_DONE" -eq 1 ]; then
    return "$exit_code"
  fi
  SHUTDOWN_DONE=1

  if [ -n "$DEV_ALL_PID" ] && kill -0 "$DEV_ALL_PID" >/dev/null 2>&1; then
    kill -TERM "$DEV_ALL_PID" >/dev/null 2>&1 || true
    if ! wait_for_pid_exit "$DEV_ALL_PID"; then
      kill -KILL "$DEV_ALL_PID" >/dev/null 2>&1 || true
      wait_for_pid_exit "$DEV_ALL_PID" 20 0.25 || true
    fi
  fi

  return "$exit_code"
}

trap cleanup EXIT INT TERM HUP

# Stop leftovers, start stack, then clean test data after API/Web are available.
./scripts/stop-all.sh || true
./scripts/dev-all.sh &
DEV_ALL_PID=$!

./scripts/wait-web-dev-ready.sh "http://127.0.0.1:3003/pedidos" 180
curl -fsS "http://127.0.0.1:3001/health" >/dev/null
"$PNPM_BIN" cleanup:test-data

echo "refresh-and-start: ambiente pronto e dados de teste limpos."
wait "$DEV_ALL_PID"
