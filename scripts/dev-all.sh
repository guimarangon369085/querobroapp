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

API_PID=""
WEB_PID=""
SHUTDOWN_DONE=0
API_AUTH_ENABLED="${APP_AUTH_ENABLED:-false}"

wait_for_http() {
  local name="$1"
  local url="$2"
  local timeout_seconds="$3"
  local elapsed=0

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name online: $url"
      return 0
    fi
    elapsed=$((elapsed + 1))
    sleep 1
  done

  echo "Timeout aguardando $name em $url"
  return 1
}

collect_descendants_postorder() {
  local parent_pid="$1"
  local child_pid

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [ -z "$child_pid" ] && continue
    collect_descendants_postorder "$child_pid"
    printf '%s\n' "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

signal_process_tree() {
  local pid="$1"
  local signal_name="$2"
  local child_pid

  [ -z "$pid" ] && return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [ -z "$child_pid" ] && continue
    kill "-${signal_name}" "$child_pid" >/dev/null 2>&1 || true
  done < <(collect_descendants_postorder "$pid")

  kill "-${signal_name}" "$pid" >/dev/null 2>&1 || true
}

wait_for_pid_exit() {
  local pid="$1"
  local attempts="${2:-30}"
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

terminate_managed_process() {
  local pid="$1"
  local label="$2"

  [ -z "$pid" ] && return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  echo "Encerrando ${label} (PID ${pid}) com TERM..."
  signal_process_tree "$pid" TERM
  if wait_for_pid_exit "$pid"; then
    return 0
  fi

  echo "${label} (PID ${pid}) nao encerrou no tempo; escalando para KILL..."
  signal_process_tree "$pid" KILL
  wait_for_pid_exit "$pid" 20 0.25 || true
}

cleanup() {
  local exit_code=$?

  if [ "$SHUTDOWN_DONE" -eq 1 ]; then
    return "$exit_code"
  fi
  SHUTDOWN_DONE=1

  echo
  echo "Encerrando ambiente QUEROBROAPP..."

  terminate_managed_process "$WEB_PID" "WEB"
  terminate_managed_process "$API_PID" "API"

  ./scripts/kill-ports.sh >/dev/null 2>&1 || true
  echo "Ambiente finalizado."

  return "$exit_code"
}

trap cleanup EXIT INT TERM HUP

./scripts/kill-ports.sh
./scripts/reset-web-dev-cache.sh
"$PNPM_BIN" --filter @querobroapp/shared build
"$PNPM_BIN" --filter @querobroapp/api prisma:migrate:dev

# Start API and Web in background and keep this shell alive as lifecycle owner.
APP_AUTH_ENABLED="$API_AUTH_ENABLED" "$PNPM_BIN" --filter @querobroapp/api dev > /tmp/querobroapp-api.log 2>&1 &
API_PID=$!

"$PNPM_BIN" --filter @querobroapp/web dev > /tmp/querobroapp-web.log 2>&1 &
WEB_PID=$!

cat <<EOF
API PID: $API_PID (logs: /tmp/querobroapp-api.log)
WEB PID: $WEB_PID (logs: /tmp/querobroapp-web.log)
EOF

wait_for_http "API" "http://127.0.0.1:3001/health" 120
./scripts/wait-web-dev-ready.sh "http://127.0.0.1:3000/pedidos" 120

if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:3000/pedidos" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:3000/pedidos" >/dev/null 2>&1 || true
fi

echo "URL: http://127.0.0.1:3000/pedidos"
echo "Feche esta janela (ou Ctrl+C) para encerrar API e Web."

while true; do
  if ! kill -0 "$API_PID" >/dev/null 2>&1; then
    echo "API encerrou inesperadamente."
    exit 1
  fi
  if ! kill -0 "$WEB_PID" >/dev/null 2>&1; then
    echo "WEB encerrou inesperadamente."
    exit 1
  fi
  sleep 2
done
