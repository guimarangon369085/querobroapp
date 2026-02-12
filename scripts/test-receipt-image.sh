#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV_FILE="$ROOT_DIR/apps/api/.env"

IMAGE_PATH="${1:-}"
BASE_URL="${2:-http://127.0.0.1:3001}"
ENDPOINT_PATH="${3:-/receipts/ingest}"

if [ -z "$IMAGE_PATH" ]; then
  echo "Uso: ./scripts/test-receipt-image.sh <caminho_da_imagem> [base_url] [endpoint]"
  echo "Exemplo JSON: ./scripts/test-receipt-image.sh /tmp/cupom.jpg http://127.0.0.1:3001 /receipts/ingest"
  echo "Exemplo texto: ./scripts/test-receipt-image.sh /tmp/cupom.jpg http://127.0.0.1:3001 /receipts/ingest-notification"
  exit 1
fi

if [ ! -f "$IMAGE_PATH" ]; then
  echo "Imagem nao encontrada: $IMAGE_PATH"
  exit 1
fi

extract_env_value() {
  local key="$1"
  local value=""
  if [ -f "$API_ENV_FILE" ]; then
    value="$(grep -E "^${key}=" "$API_ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
  fi
  printf '%s' "$value"
}

MIME_TYPE="$(file --mime-type -b "$IMAGE_PATH" 2>/dev/null || echo image/jpeg)"
IMAGE_BASE64="$(base64 < "$IMAGE_PATH" | tr -d '\n')"
TOKEN_VALUE="${RECEIPTS_API_TOKEN:-$(extract_env_value RECEIPTS_API_TOKEN)}"

REQUEST_JSON="$(cat <<EOF
{"imageBase64":"$IMAGE_BASE64","mimeType":"$MIME_TYPE"}
EOF
)"

URL="${BASE_URL%/}${ENDPOINT_PATH}"
echo "Testando endpoint: $URL"

TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

if [ -n "$TOKEN_VALUE" ]; then
  HTTP_CODE="$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "x-receipts-token: $TOKEN_VALUE" \
    -d "$REQUEST_JSON")"
else
  HTTP_CODE="$(curl -sS -o "$TMP_BODY" -w '%{http_code}' -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "$REQUEST_JSON")"
fi

echo "HTTP: $HTTP_CODE"
echo "Resposta:"
if command -v jq >/dev/null 2>&1 && head -c 1 "$TMP_BODY" | grep -q '{'; then
  jq . "$TMP_BODY"
else
  cat "$TMP_BODY"
fi
echo
