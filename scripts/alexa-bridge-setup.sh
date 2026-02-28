#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV_FILE="$ROOT_DIR/apps/api/.env"
PORT="${1:-3001}"

extract_env_value() {
  local key="$1"
  local value=""
  if [ -f "$API_ENV_FILE" ]; then
    value="$(grep -E "^${key}=" "$API_ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
  fi
  printf '%s' "$value"
}

mask_value() {
  local value="$1"
  local size=${#value}
  if [ "$size" -le 6 ]; then
    printf '***'
    return
  fi
  printf '%s***%s' "${value:0:3}" "${value: -2}"
}

HOST_VALUE="${HOST:-127.0.0.1}"
BASE_URL="http://$HOST_VALUE:$PORT/alexa/bridge"
ALEXA_TOKEN="$(extract_env_value ALEXA_BRIDGE_TOKEN)"
ALEXA_HMAC_SECRET="$(extract_env_value ALEXA_BRIDGE_HMAC_SECRET)"
AUTOMATIONS_TOKEN="$(extract_env_value AUTOMATIONS_API_TOKEN)"
RECEIPTS_TOKEN="$(extract_env_value RECEIPTS_API_TOKEN)"
SKILL_IDS="$(extract_env_value ALEXA_ALLOWED_SKILL_IDS)"

echo "=== QUEROBROAPP - Alexa Bridge Setup ==="
echo "Bridge URL (local): $BASE_URL"
echo
echo "Para Alexa real, publique este endpoint com HTTPS (Cloudflare Tunnel, ngrok ou dominio)."
echo

if [ -n "$ALEXA_TOKEN" ]; then
  echo "Token dedicado detectado:"
  echo "  x-alexa-token: $(mask_value "$ALEXA_TOKEN")"
elif [ -n "$AUTOMATIONS_TOKEN" ]; then
  echo "Token fallback detectado (AUTOMATIONS_API_TOKEN):"
  echo "  x-alexa-token: $(mask_value "$AUTOMATIONS_TOKEN")"
elif [ -n "$RECEIPTS_TOKEN" ]; then
  echo "Token fallback detectado (RECEIPTS_API_TOKEN):"
  echo "  x-alexa-token: $(mask_value "$RECEIPTS_TOKEN")"
else
  echo "Nenhum token detectado em apps/api/.env (modo dev aberto)."
fi

if [ -n "$ALEXA_HMAC_SECRET" ]; then
  echo "HMAC secret detectado:"
  echo "  x-alexa-signature: sha256=<assinado com secret>"
else
  echo "ALEXA_BRIDGE_HMAC_SECRET nao detectado."
fi

if [ -n "$SKILL_IDS" ]; then
  echo "ALEXA_ALLOWED_SKILL_IDS configurado: $SKILL_IDS"
else
  echo "ALEXA_ALLOWED_SKILL_IDS vazio (qualquer applicationId aceito no bridge)."
fi

echo
echo "Payload de teste:"
cat <<'EOF'
{
  "applicationId": "amzn1.ask.skill.exemplo",
  "userId": "amzn1.ask.account.exemplo",
  "locale": "pt-BR",
  "requestType": "IntentRequest",
  "requestId": "test-1",
  "intentName": "SyncSupplierPricesIntent",
  "slots": {}
}
EOF

echo
echo "Teste rapido:"
echo "curl -X POST '$BASE_URL' \\"
echo "  -H 'content-type: application/json' \\"
echo "  -H 'x-alexa-token: <TOKEN>' \\"
echo "  -H 'x-alexa-timestamp: <epoch_seconds>' \\"
echo "  -H 'x-alexa-signature: sha256=<hex>' \\"
echo "  --data '{\"applicationId\":\"amzn1.ask.skill.exemplo\",\"requestType\":\"LaunchRequest\"}'"
