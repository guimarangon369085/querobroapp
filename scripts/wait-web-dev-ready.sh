#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
WEB_URL="${1:-http://127.0.0.1:3000/pedidos}"
TIMEOUT_SECONDS="${2:-120}"
ELAPSED=0
WEB_BASE_URL="$(printf '%s' "$WEB_URL" | sed -E 's#(https?://[^/]+).*#\1#')"
WEB_PORT="$(printf '%s' "$WEB_BASE_URL" | sed -E 's#https?://[^:/]+:([0-9]+)#\1#')"

if [ -z "$WEB_PORT" ] || [ "$WEB_PORT" = "$WEB_BASE_URL" ]; then
  WEB_PORT=80
fi

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

are_next_assets_ready() {
  local page_html
  local script_paths
  local asset_path

  page_html="$(curl -fsS "$WEB_URL" 2>/dev/null || true)"
  if [ -z "$page_html" ]; then
    return 1
  fi

  script_paths="$(printf '%s' "$page_html" | grep -oE 'src="/_next[^"]+\.js[^"]*"' | sed -E 's/^src="([^"]+)"$/\1/' || true)"
  if [ -z "$script_paths" ]; then
    return 1
  fi

  while IFS= read -r asset_path; do
    [ -z "$asset_path" ] && continue
    if ! curl -fsS "${WEB_BASE_URL}${asset_path}" >/dev/null 2>&1; then
      return 1
    fi
  done <<< "$script_paths"

  return 0
}

while [ "$ELAPSED" -lt "$TIMEOUT_SECONDS" ]; do
  if is_port_listening "$WEB_PORT" && are_next_assets_ready; then
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
