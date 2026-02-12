#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_ENV_FILE="$ROOT_DIR/apps/api/.env"
API_ENV_EXAMPLE="$ROOT_DIR/apps/api/.env.example"
API_LOG_FILE="/tmp/querobroapp-api.log"
API_PORT="${1:-3001}"

ensure_api_env_file() {
  if [ -f "$API_ENV_FILE" ]; then
    return
  fi
  if [ -f "$API_ENV_EXAMPLE" ]; then
    cp "$API_ENV_EXAMPLE" "$API_ENV_FILE"
    return
  fi
  touch "$API_ENV_FILE"
}

get_env_value() {
  local key="$1"
  local value=""
  if [ -f "$API_ENV_FILE" ]; then
    value="$(grep -E "^${key}=" "$API_ENV_FILE" | tail -n 1 | cut -d'=' -f2- || true)"
  fi
  printf '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  ensure_api_env_file
  if grep -qE "^${key}=" "$API_ENV_FILE"; then
    # macOS sed
    sed -i '' "s|^${key}=.*$|${key}=${value}|" "$API_ENV_FILE"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$API_ENV_FILE"
  fi
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

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_health() {
  local tries=40
  local url="http://127.0.0.1:${API_PORT}/health"
  for _ in $(seq 1 "$tries"); do
    local code
    code="$(curl -s -o /tmp/querobroapp-health.json -w '%{http_code}' "$url" || true)"
    if [ "$code" = "200" ]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

echo "=== SETUP OPENAI + CUPOM ==="

current_key="$(get_env_value OPENAI_API_KEY)"
if [ -n "$current_key" ]; then
  echo "OPENAI_API_KEY ja configurada em apps/api/.env: $(mask_value "$current_key")"
else
  echo "OPENAI_API_KEY ausente em apps/api/.env."
  echo "Cole a OPENAI_API_KEY e pressione Enter (o texto fica oculto)."
  read -r -s -p "OPENAI_API_KEY: " new_key
  echo
  if [ -z "${new_key:-}" ] && command -v pbpaste >/dev/null 2>&1; then
    clipboard_key="$(pbpaste 2>/dev/null || true)"
    if [[ "${clipboard_key}" == sk-* ]]; then
      new_key="$clipboard_key"
      echo "Usando chave da area de transferencia."
    fi
    unset clipboard_key
  fi
  if [ -z "${new_key:-}" ]; then
    echo "Chave vazia. Nao foi possivel concluir a configuracao."
    exit 1
  fi
  # Remove quebra de linha acidental ao colar.
  new_key="${new_key//$'\r'/}"
  new_key="${new_key//$'\n'/}"
  set_env_value OPENAI_API_KEY "$new_key"
  echo "OPENAI_API_KEY salva com sucesso: $(mask_value "$new_key")"
  unset new_key
fi

auth_enabled="$(get_env_value APP_AUTH_ENABLED)"
auth_enabled_normalized="$(printf '%s' "$auth_enabled" | tr '[:upper:]' '[:lower:]')"
auth_token="$(get_env_value APP_AUTH_TOKEN)"
auth_tokens="$(get_env_value APP_AUTH_TOKENS)"

if [ "$auth_enabled_normalized" = "true" ] || [ "$auth_enabled_normalized" = "1" ]; then
  if [ -z "$auth_token" ] && [ -z "$auth_tokens" ]; then
    echo "APP_AUTH_ENABLED=true detectado e nenhum token de app foi encontrado."
    echo "Cole um APP_AUTH_TOKEN para liberar chamadas do Atalhos."
    read -r -s -p "APP_AUTH_TOKEN: " new_auth_token
    echo
    if [ -z "${new_auth_token:-}" ] && command -v pbpaste >/dev/null 2>&1; then
      clipboard_auth_token="$(pbpaste 2>/dev/null || true)"
      if [ -n "$clipboard_auth_token" ]; then
        new_auth_token="$clipboard_auth_token"
        echo "Usando token da area de transferencia."
      fi
      unset clipboard_auth_token
    fi
    if [ -z "${new_auth_token:-}" ]; then
      echo "Token vazio. Nao foi possivel concluir a configuracao."
      exit 1
    fi
    new_auth_token="${new_auth_token//$'\r'/}"
    new_auth_token="${new_auth_token//$'\n'/}"
    set_env_value APP_AUTH_TOKEN "$new_auth_token"
    echo "APP_AUTH_TOKEN salvo com sucesso: $(mask_value "$new_auth_token")"
    unset new_auth_token
  fi
fi

if is_port_listening "$API_PORT"; then
  echo "API ja esta rodando na porta ${API_PORT}."
else
  echo "Iniciando API na porta ${API_PORT}..."
  (
    cd "$ROOT_DIR/apps/api"
    nohup pnpm dev >"$API_LOG_FILE" 2>&1 &
  )
fi

if wait_for_health; then
  echo "API respondeu health check em http://127.0.0.1:${API_PORT}/health"
else
  echo "API nao respondeu health check. Verifique log: $API_LOG_FILE"
  exit 1
fi

echo
"$ROOT_DIR/scripts/shortcut-receipts-setup.sh" "$API_PORT"
echo
echo "Setup concluido."
