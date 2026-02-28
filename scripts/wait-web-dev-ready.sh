#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
WEB_URL="${1:-http://127.0.0.1:3000/pedidos}"
TIMEOUT_SECONDS="${2:-120}"
ELAPSED=0

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

while [ "$ELAPSED" -lt "$TIMEOUT_SECONDS" ]; do
  if is_port_listening 3000 \
    && [ -f "$WEB_DIR/.next/routes-manifest.json" ] \
    && [ -f "$WEB_DIR/.next/server/app-paths-manifest.json" ]; then
    if curl -fsS "$WEB_URL" >/dev/null 2>&1; then
      echo "WEB online: $WEB_URL"
      exit 0
    fi
  fi

  ELAPSED=$((ELAPSED + 1))
  sleep 1
done

echo "Timeout aguardando WEB pronto: $WEB_URL"
exit 1
