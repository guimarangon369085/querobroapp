#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV_FILE="$ROOT_DIR/apps/api/.env"
PORT="${1:-3001}"

detect_ip() {
  local ip=""
  local default_iface=""
  local candidate_iface=""

  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [ -z "$ip" ]; then
    ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  fi

  if [ -z "$ip" ] && command -v route >/dev/null 2>&1; then
    default_iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)"
    if [ -n "$default_iface" ] && command -v ipconfig >/dev/null 2>&1; then
      ip="$(ipconfig getifaddr "$default_iface" 2>/dev/null || true)"
    fi
  fi

  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    for candidate_iface in en0 en1 en2; do
      ip="$(
        ifconfig "$candidate_iface" 2>/dev/null \
          | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' \
          || true
      )"
      if [ -n "$ip" ]; then
        break
      fi
    done
  fi

  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    ip="$(
      ifconfig 2>/dev/null \
        | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}' \
        || true
    )"
  fi

  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s' "$ip"
}

detect_local_hostname() {
  local host=""
  host="$(scutil --get LocalHostName 2>/dev/null || true)"
  if [ -z "$host" ] && command -v hostname >/dev/null 2>&1; then
    host="$(hostname -s 2>/dev/null || true)"
  fi
  printf '%s' "$host"
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
LOCAL_HOSTNAME="$(detect_local_hostname)"
if [ -z "$IP_ADDR" ]; then
  echo "Nao foi possivel detectar IP local automaticamente."
  echo "Defina manualmente no Atalhos: http://SEU_IP:$PORT"
  exit 1
fi

TOKEN_VALUE="$(extract_env_value RECEIPTS_API_TOKEN)"
OPENAI_SET="$(extract_env_value OPENAI_API_KEY)"
AUTH_ENABLED="$(extract_env_value APP_AUTH_ENABLED)"
APP_AUTH_TOKEN="$(extract_env_value APP_AUTH_TOKEN)"
AUTH_ENABLED_NORMALIZED="$(printf '%s' "$AUTH_ENABLED" | tr '[:upper:]' '[:lower:]')"

BASE_URL="http://$IP_ADDR:$PORT/receipts"

echo "=== INTEGRACAO iOS SHORTCUTS (CUPOM) ==="
echo "IP local detectado: $IP_ADDR"
if [ -n "$LOCAL_HOSTNAME" ]; then
  echo "Host local detectado: ${LOCAL_HOSTNAME}.local"
fi
echo "Base URL: $BASE_URL"
echo
echo "Endpoint simples para notificacao no iPhone (text/plain, recomendado):"
echo "  POST $BASE_URL/ingest-notification"
if [ -n "$LOCAL_HOSTNAME" ]; then
  echo "  alternativa estavel: http://${LOCAL_HOSTNAME}.local:$PORT/receipts/ingest-notification"
fi
echo
echo "Endpoint JSON detalhado (tambem atualiza estoque):"
echo "  POST $BASE_URL/ingest"
echo
echo "Endpoint legacy de compatibilidade (atualiza estoque por padrao):"
echo "  POST $BASE_URL/parse"
echo "  (para somente preview sem estoque: header x-receipts-preview: true)"
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
echo "Header recomendado para retries seguros:"
echo "  idempotency-key: <chave_unica_por_cupom>"
if [ "$AUTH_ENABLED_NORMALIZED" = "true" ] || [ "$AUTH_ENABLED_NORMALIZED" = "1" ]; then
  if [ -n "$APP_AUTH_TOKEN" ]; then
    echo "Header obrigatorio (Auth global ativo):"
    echo "  x-app-token: $(mask_value "$APP_AUTH_TOKEN")"
  else
    echo "Auth global ativo, mas APP_AUTH_TOKEN nao encontrado em apps/api/.env."
    echo "Defina APP_AUTH_TOKEN para liberar chamadas no Atalhos."
  fi
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
  "mimeType": "image/jpeg",
  "rawText": "<texto_extraido_por_ocr_no_iphone_opcional>"
}
EOF
echo
echo "Proximo passo:"
echo "1) Inicie a API."
echo "2) No iPhone, use essa URL no Atalhos (porta 3001, nao 3000)."
echo "3) Para automacao de estoque sem copiar/colar, use /ingest-notification."
echo "4) No Atalhos, em 'Codificar em Base64', defina 'Quebras de Linha' = 'Nenhuma'."
echo "5) Para reduzir dependencia de IA/token, inclua rawText via acao 'Extrair texto da imagem'."
echo "6) Sem rawText, no macOS a API tenta OCR local da imagem antes de usar OpenAI."
echo "7) Use idempotency-key unica por cupom para evitar duplicidade/replay."
echo "8) No 'Mostrar notificacao', use a variavel 'Conteudos do URL' (nao escreva [Resultado])."
