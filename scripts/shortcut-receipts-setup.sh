#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV_FILE="$ROOT_DIR/apps/api/.env"
PORT="${1:-3001}"

detect_ip() {
  local ip=""
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "$ip"
}

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
  if [ "$size" -le 5 ]; then
    printf '***'
    return
  fi
  printf '%s***%s' "${value:0:3}" "${value: -2}"
}

IP_ADDR="$(detect_ip)"
if [ -z "$IP_ADDR" ]; then
  echo "Nao foi possivel detectar IP local automaticamente."
  echo "Defina manualmente no Atalhos: http://SEU_IP:$PORT"
  exit 1
fi

TOKEN_VALUE="$(extract_env_value RECEIPTS_API_TOKEN)"
OPENAI_SET="$(extract_env_value OPENAI_API_KEY)"

BASE_URL="http://$IP_ADDR:$PORT/receipts"

echo "=== INTEGRACAO iOS SHORTCUTS (CUPOM) ==="
echo "IP local detectado: $IP_ADDR"
echo "Base URL: $BASE_URL"
echo
echo "Endpoint JSON (retorna clipboardText no JSON):"
echo "  POST $BASE_URL/parse"
echo
echo "Endpoint para lancar estoque automaticamente (recomendado):"
echo "  POST $BASE_URL/ingest"
echo
echo "Endpoint simples para notificacao no iPhone (text/plain):"
echo "  POST $BASE_URL/ingest-notification"
echo
echo "Endpoint direto para colar (retorna text/plain):"
echo "  POST $BASE_URL/parse-clipboard"
echo
if [ -n "$TOKEN_VALUE" ]; then
  echo "Header obrigatorio detectado:"
  echo "  x-receipts-token: $(mask_value "$TOKEN_VALUE")"
else
  echo "Header opcional:"
  echo "  x-receipts-token (somente se voce definir RECEIPTS_API_TOKEN)"
fi
echo
if [ -n "$OPENAI_SET" ]; then
  echo "OPENAI_API_KEY: configurada (apps/api/.env)"
else
  echo "OPENAI_API_KEY: NAO configurada em apps/api/.env"
  echo "Sem isso o endpoint retorna erro 400."
fi
echo
echo "Payload JSON esperado:"
cat <<'EOF'
{
  "imageBase64": "<base64_da_foto>",
  "mimeType": "image/jpeg"
}
EOF
echo
echo "Proximo passo:"
echo "1) Inicie a API."
echo "2) No iPhone, use essa URL no Atalhos."
echo "3) Para automacao de estoque sem copiar/colar, use /ingest."
echo "4) No Atalhos, em 'Codificar em Base64', defina 'Quebras de Linha' = 'Nenhuma'."
echo "5) Para notificacao sem erro de variavel, use /ingest-notification."
echo "6) No 'Mostrar notificacao', use a variavel 'Conteudos do URL' (nao escreva [Resultado])."
