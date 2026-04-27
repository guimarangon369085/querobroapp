#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

API_ENV_FILE="$ROOT_DIR/apps/api/.env"
WEB_ENV_FILE="$ROOT_DIR/apps/web/.env"
FAILURES=0
WARNINGS=0

trim_value() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

read_env_value() {
  local file_path="$1"
  local key="$2"

  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      prefix = key "="
      if (index(line, prefix) == 1) {
        print substr(line, length(prefix) + 1)
        exit
      }
    }
  ' "$file_path"
}

has_value() {
  local raw
  raw="$(read_env_value "$1" "$2" || true)"
  [[ -n "$(trim_value "$raw")" ]]
}

fail() {
  echo "ERRO: $1" >&2
  FAILURES=$((FAILURES + 1))
}

warn() {
  echo "WARN: $1" >&2
  WARNINGS=$((WARNINGS + 1))
}

if [[ ! -f "$API_ENV_FILE" ]]; then
  fail "apps/api/.env ausente. Copie apps/api/.env.example antes de subir o ambiente."
fi

if [[ ! -f "$WEB_ENV_FILE" ]]; then
  fail "apps/web/.env ausente. Copie apps/web/.env.example antes de subir o ambiente."
fi

if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi

if [[ "$(trim_value "$(read_env_value "$API_ENV_FILE" "APP_AUTH_ENABLED" || true)")" =~ ^(1|true|yes|y|on)$ ]]; then
  if ! has_value "$API_ENV_FILE" "APP_AUTH_TOKEN" && ! has_value "$API_ENV_FILE" "APP_AUTH_TOKENS"; then
    fail "apps/api/.env liga APP_AUTH_ENABLED=true, mas nao define APP_AUTH_TOKEN nem APP_AUTH_TOKENS."
  fi
fi

if [[ "$(trim_value "$(read_env_value "$WEB_ENV_FILE" "APP_OPS_AUTH_ENABLED" || true)")" =~ ^(1|true|yes|y|on)$ ]]; then
  if \
    ! has_value "$WEB_ENV_FILE" "APP_AUTH_TOKEN" && \
    ! has_value "$WEB_ENV_FILE" "APP_AUTH_TOKENS" && \
    ! has_value "$WEB_ENV_FILE" "APP_API_BRIDGE_TOKEN" && \
    ! has_value "$WEB_ENV_FILE" "INTERNAL_BASIC_AUTH_PASSWORD"; then
    fail "apps/web/.env liga APP_OPS_AUTH_ENABLED=true, mas nao define credencial operacional alguma."
  fi
fi

if ! has_value "$API_ENV_FILE" "ORDER_FORM_BRIDGE_TOKEN"; then
  warn "apps/api/.env sem ORDER_FORM_BRIDGE_TOKEN. Intake/preview/cotacao publica podem falhar se auth estiver ligada."
fi

if ! has_value "$WEB_ENV_FILE" "ORDER_FORM_BRIDGE_TOKEN"; then
  warn "apps/web/.env sem ORDER_FORM_BRIDGE_TOKEN. Rotas /api/google-form, /api/customer-form e /api/delivery-quote podem ficar incompletas."
fi

if ! has_value "$WEB_ENV_FILE" "NEXT_PUBLIC_API_URL"; then
  warn "apps/web/.env sem NEXT_PUBLIC_API_URL. O web pode depender de fallback implicito para falar com a API local."
fi

if [[ "$FAILURES" -gt 0 ]]; then
  exit 1
fi

echo "Local env guard OK (${WARNINGS} aviso(s))."
