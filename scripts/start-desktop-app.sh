#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./scripts/runtime-path.sh
source "$ROOT_DIR/scripts/runtime-path.sh"
setup_runtime_path

API_URL="http://127.0.0.1:3001/health"
WEB_URL="http://127.0.0.1:3000/pedidos"
API_LOG="/tmp/querobroapp-api.log"
WEB_LOG="/tmp/querobroapp-web.log"
UID_VALUE="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
API_LABEL="com.querobroapp.api"
WEB_LABEL="com.querobroapp.web"
API_PLIST="$AGENTS_DIR/$API_LABEL.plist"
WEB_PLIST="$AGENTS_DIR/$WEB_LABEL.plist"
PNPM_BIN="$(command -v pnpm || true)"

if [ -z "$PNPM_BIN" ]; then
  echo "pnpm nao encontrado no PATH."
  exit 1
fi

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

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

open_web() {
  if command -v open >/dev/null 2>&1; then
    open "$WEB_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$WEB_URL" >/dev/null 2>&1 || true
  fi
}

write_agent_plist() {
  local label="$1"
  local command="$2"
  local log_file="$3"
  local plist_path="$4"

  cat > "$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>$command</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$log_file</string>
  <key>StandardErrorPath</key>
  <string>$log_file</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF
}

start_launch_agent() {
  local label="$1"
  local plist_path="$2"
  launchctl bootout "gui/$UID_VALUE" "$plist_path" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_VALUE" "$plist_path"
  launchctl kickstart -k "gui/$UID_VALUE/$label" >/dev/null 2>&1 || true
}

printf -v ESCAPED_PATH '%q' "$PATH"

if is_port_listening 3000 && is_port_listening 3001; then
  echo "QUEROBROAPP ja esta em execucao."
  open_web
  exit 0
fi

./scripts/kill-ports.sh
./scripts/reset-web-dev-cache.sh

echo "Preparando ambiente..."
"$PNPM_BIN" --filter @querobroapp/shared build
"$PNPM_BIN" --filter @querobroapp/api prisma:migrate:dev

: > "$API_LOG"
: > "$WEB_LOG"

mkdir -p "$AGENTS_DIR"
write_agent_plist "$API_LABEL" "export PATH=$ESCAPED_PATH && cd '$ROOT_DIR' && '$PNPM_BIN' --filter @querobroapp/api dev" "$API_LOG" "$API_PLIST"
write_agent_plist "$WEB_LABEL" "export PATH=$ESCAPED_PATH && cd '$ROOT_DIR' && '$PNPM_BIN' --filter @querobroapp/web dev" "$WEB_LOG" "$WEB_PLIST"

echo "Iniciando API..."
start_launch_agent "$API_LABEL" "$API_PLIST"

wait_for_http "API" "$API_URL" 120

echo "Iniciando Web..."
start_launch_agent "$WEB_LABEL" "$WEB_PLIST"

./scripts/wait-web-dev-ready.sh "$WEB_URL" 120

echo "QUEROBROAPP pronto."
echo "Web: $WEB_URL"
echo "Logs API: $API_LOG"
echo "Logs Web: $WEB_LOG"

open_web
