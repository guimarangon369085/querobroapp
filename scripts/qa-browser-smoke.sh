#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${QA_BROWSER_OUTPUT_DIR:-$ROOT_DIR/output/playwright}"
SESSION_NAME="${PLAYWRIGHT_CLI_SESSION:-qa_browser_smoke}"
DEFAULT_EXISTING_WEB_URL="${QA_BROWSER_EXISTING_WEB_URL:-http://127.0.0.1:3000}"
TEMP_WEB_PORT="${QA_BROWSER_TEMP_WEB_PORT:-}"
TEMP_WEB_DIST_DIR="${QA_BROWSER_TEMP_WEB_DIST_DIR:-.next-qa-browser-smoke}"
API_PORT="${QA_BROWSER_API_PORT:-3001}"
API_URL="http://127.0.0.1:${API_PORT}"
API_AUTH_ENABLED="${APP_AUTH_ENABLED:-false}"

mkdir -p "$OUTPUT_DIR"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx nao encontrado. Instale Node.js/npm antes de rodar o browser smoke."
  exit 1
fi

export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
export PLAYWRIGHT_CLI_SESSION="$SESSION_NAME"

if [[ ! -x "$PWCLI" ]]; then
  echo "Wrapper do Playwright nao encontrado: $PWCLI"
  exit 1
fi

STARTED_API=0
STARTED_WEB=0
API_PID=""
WEB_PID=""
WEB_URL=""
USING_EXISTING_WEB=0
CLEANUP_DONE=0

collect_descendants_postorder() {
  local parent_pid="$1"
  local child_pid

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [[ -z "$child_pid" ]] && continue
    collect_descendants_postorder "$child_pid"
    printf '%s\n' "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

signal_process_tree() {
  local pid="$1"
  local signal_name="$2"
  local child_pid

  [[ -z "$pid" ]] && return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [[ -z "$child_pid" ]] && continue
    kill "-${signal_name}" "$child_pid" >/dev/null 2>&1 || true
  done < <(collect_descendants_postorder "$pid")

  kill "-${signal_name}" "$pid" >/dev/null 2>&1 || true
}

wait_for_pid_exit() {
  local pid="$1"
  local attempts="${2:-30}"
  local delay="${3:-0.25}"
  local i=1

  [[ -z "$pid" ]] && return 0
  while (( i <= attempts )); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
    ((i++))
  done

  return 1
}

terminate_managed_process() {
  local pid="$1"
  local label="$2"

  [[ -z "$pid" ]] && return 0
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  signal_process_tree "$pid" TERM
  if wait_for_pid_exit "$pid"; then
    return 0
  fi

  echo "Browser smoke: ${label} (PID ${pid}) nao encerrou no tempo; escalando para KILL"
  signal_process_tree "$pid" KILL
  wait_for_pid_exit "$pid" 20 0.25 || true
}

cleanup() {
  set +e
  if [[ "$CLEANUP_DONE" == "1" ]]; then
    return 0
  fi
  CLEANUP_DONE=1

  "$PWCLI" close >/dev/null 2>&1 || true

  if [[ "$STARTED_WEB" == "1" && -n "$WEB_PID" ]]; then
    terminate_managed_process "$WEB_PID" "web temporario"
    wait "$WEB_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$STARTED_API" == "1" && -n "$API_PID" ]]; then
    terminate_managed_process "$API_PID" "API temporaria"
    wait "$API_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM HUP

wait_for_url() {
  local url="$1"
  local attempts="${2:-60}"
  local delay="${3:-0.5}"
  local i=1

  while (( i <= attempts )); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
    ((i++))
  done

  return 1
}

existing_web_assets_ok() {
  local page_html
  local script_paths

  page_html="$(curl -fs "${DEFAULT_EXISTING_WEB_URL}/pedidos" 2>/dev/null || true)"
  if [[ -z "$page_html" ]]; then
    return 1
  fi

  script_paths="$(printf '%s' "$page_html" | grep -oE 'src="/_next[^"]+\.js[^"]*"' | sed -E 's/^src="([^"]+)"$/\1/' || true)"
  if [[ -z "$script_paths" ]]; then
    return 1
  fi

  while IFS= read -r asset_path; do
    [[ -z "$asset_path" ]] && continue
    if ! curl -sf "${DEFAULT_EXISTING_WEB_URL}${asset_path}" >/dev/null 2>&1; then
      return 1
    fi
  done <<< "$script_paths"

  return 0
}

is_api_compatible() {
  local payload
  payload="$(curl -sf "${API_URL}/production/queue" 2>/dev/null || true)"

  if [[ -z "$payload" ]]; then
    return 1
  fi

  if [[ "$payload" != *'"queue":['* ]]; then
    return 1
  fi

  if [[ "$payload" != *'"recentBatches":['* ]]; then
    return 1
  fi

  return 0
}

is_port_in_use() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

kill_port_processes() {
  local port="$1"
  local pids

  if ! command -v lsof >/dev/null 2>&1; then
    echo "Browser smoke: lsof nao encontrado para liberar a porta ${port}"
    exit 1
  fi

  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Browser smoke: encerrando processo(s) stale na porta ${port}: $(printf '%s' "$pids" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    terminate_managed_process "$pid" "listener na porta ${port}"
  done <<< "$pids"

  if ! is_port_in_use "$port"; then
    return 0
  fi

  echo "Browser smoke: nao foi possivel liberar a porta ${port}"
  exit 1
}

resolve_temp_web_port() {
  if [[ -n "$TEMP_WEB_PORT" ]]; then
    printf '%s' "$TEMP_WEB_PORT"
    return 0
  fi

  if ! is_port_in_use 3000; then
    printf '3000'
    return 0
  fi

  printf '3100'
}

ensure_api_server() {
  if curl -sf "${API_URL}/health" >/dev/null 2>&1 && is_api_compatible; then
    echo "Browser smoke: usando API existente em ${API_URL}"
    return 0
  fi

  if curl -sf "${API_URL}/health" >/dev/null 2>&1; then
    kill_port_processes "$API_PORT"
  fi

  echo "Browser smoke: build da API"
  (cd "$ROOT_DIR" && pnpm --filter @querobroapp/api build)

  echo "Browser smoke: iniciando API temporaria em ${API_URL}"
  (
    cd "$ROOT_DIR/apps/api"
    APP_AUTH_ENABLED="$API_AUTH_ENABLED" PORT="$API_PORT" node dist/main.js >"$OUTPUT_DIR/qa-browser-api.log" 2>&1
  ) &
  API_PID="$!"
  STARTED_API=1

  if ! wait_for_url "${API_URL}/health" 60 0.5; then
    echo "Browser smoke: API nao subiu em ${API_URL}"
    exit 1
  fi

  if ! is_api_compatible; then
    echo "Browser smoke: API iniciada em ${API_URL} nao expoe /production/queue como esperado"
    exit 1
  fi
}

ensure_web_server() {
  local chosen_temp_web_port
  local chosen_temp_web_url

  if curl -sf "${DEFAULT_EXISTING_WEB_URL}/pedidos" >/dev/null 2>&1 && existing_web_assets_ok; then
    WEB_URL="$DEFAULT_EXISTING_WEB_URL"
    USING_EXISTING_WEB=1
    echo "Browser smoke: usando web existente em ${WEB_URL}"
    return 0
  fi

  if curl -sf "${DEFAULT_EXISTING_WEB_URL}/pedidos" >/dev/null 2>&1; then
    echo "Browser smoke: web existente em ${DEFAULT_EXISTING_WEB_URL} respondeu HTML, mas os assets _next estao inconsistentes; usando web temporario"
  fi

  if [[ -z "$TEMP_WEB_DIST_DIR" ]]; then
    echo "Browser smoke: TEMP_WEB_DIST_DIR vazio"
    exit 1
  fi

  echo "Browser smoke: limpando dist temporario do web (${TEMP_WEB_DIST_DIR})"
  (
    cd "$ROOT_DIR/apps/web"
    rm -rf -- "$TEMP_WEB_DIST_DIR"
  )

  echo "Browser smoke: build do web"
  (cd "$ROOT_DIR" && NEXT_DIST_DIR="$TEMP_WEB_DIST_DIR" pnpm --filter @querobroapp/web build)

  chosen_temp_web_port="$(resolve_temp_web_port)"
  chosen_temp_web_url="http://127.0.0.1:${chosen_temp_web_port}"

  echo "Browser smoke: iniciando web temporario em ${chosen_temp_web_url}"
  (
    cd "$ROOT_DIR/apps/web"
    NEXT_DIST_DIR="$TEMP_WEB_DIST_DIR" pnpm exec next start -H 127.0.0.1 -p "$chosen_temp_web_port" >"$OUTPUT_DIR/qa-browser-web.log" 2>&1
  ) &
  WEB_PID="$!"
  STARTED_WEB=1
  WEB_URL="$chosen_temp_web_url"

  if ! wait_for_url "${WEB_URL}/pedidos" 60 0.5; then
    echo "Browser smoke: web nao subiu em ${WEB_URL}"
    exit 1
  fi
}

latest_console_log() {
  ls -t "$ROOT_DIR"/.playwright-cli/console-*.log 2>/dev/null | sed -n '1p'
}

latest_network_log() {
  ls -t "$ROOT_DIR"/.playwright-cli/network-*.log 2>/dev/null | sed -n '1p'
}

assert_console_clean() {
  local route_name="$1"
  "$PWCLI" console error >/dev/null

  local source_log
  source_log="$(latest_console_log)"
  if [[ -z "$source_log" || ! -f "$source_log" ]]; then
    echo "Browser smoke: log de console nao encontrado para ${route_name}"
    exit 1
  fi

  cp "$source_log" "$OUTPUT_DIR/${route_name}-console.log"

  if grep -Eq 'Errors: [1-9][0-9]*' "$source_log"; then
    echo "Browser smoke: erros de console em ${route_name}"
    sed -n '1,120p' "$source_log"
    exit 1
  fi
}

assert_network_clean() {
  local route_name="$1"
  local source_log
  local filtered_log

  "$PWCLI" network >/dev/null

  source_log="$(latest_network_log)"
  if [[ -z "$source_log" || ! -f "$source_log" ]]; then
    echo "Browser smoke: log de rede nao encontrado para ${route_name}"
    exit 1
  fi

  cp "$source_log" "$OUTPUT_DIR/${route_name}-network.log"

  filtered_log="$source_log"
  if [[ "$USING_EXISTING_WEB" == "1" ]]; then
    filtered_log="$OUTPUT_DIR/${route_name}-network-filtered.log"
    grep -Ev '/favicon\.ico|/apple-touch-icon(\.png)?|/_next/static/webpack/.*\.hot-update\.(js|json) => \[FAILED\] net::ERR_ABORTED|\?_rsc=.*=> \[FAILED\] net::ERR_ABORTED' "$source_log" >"$filtered_log" || true
  fi

  if grep -Eq '=> \[(FAILED|4[0-9]{2}|5[0-9]{2})\]' "$filtered_log"; then
    echo "Browser smoke: falhas de rede em ${route_name}"
    grep -En '=> \[(FAILED|4[0-9]{2}|5[0-9]{2})\]' "$filtered_log" | sed -n '1,40p'
    exit 1
  fi
}

assert_page_contains() {
  local route_name="$1"
  local expected_text="$2"
  local evaluation

  evaluation="$("$PWCLI" eval "document.body.innerText.includes('${expected_text}')")"
  printf '%s\n' "$evaluation" >"$OUTPUT_DIR/${route_name}-contains.txt"

  if ! printf '%s\n' "$evaluation" | grep -q '^true$'; then
    echo "Browser smoke: a tela ${route_name} nao exibiu o texto esperado: ${expected_text}"
    printf '%s\n' "$evaluation"
    exit 1
  fi
}

assert_path_contains() {
  local route_name="$1"
  local expected_path_fragment="$2"
  local evaluation

  evaluation="$("$PWCLI" eval "window.location.pathname.includes('${expected_path_fragment}')")"
  printf '%s\n' "$evaluation" >"$OUTPUT_DIR/${route_name}-path-contains.txt"

  if ! printf '%s\n' "$evaluation" | grep -q '^true$'; then
    echo "Browser smoke: a rota ${route_name} nao redirecionou para o path esperado: ${expected_path_fragment}"
    printf '%s\n' "$evaluation"
    exit 1
  fi
}

open_or_navigate() {
  local url="$1"

  if [[ -z "${BROWSER_OPENED:-}" ]]; then
    "$PWCLI" open "$url" >/dev/null
    BROWSER_OPENED=1
    return 0
  fi

  "$PWCLI" goto "$url" >/dev/null
}

check_route() {
  local route_name="$1"
  local route_path="$2"
  local expected_text="$3"
  local expected_path_fragment="${4:-}"

  echo "Browser smoke: validando ${route_name} (${route_path})"
  open_or_navigate "${WEB_URL}${route_path}"
  "$PWCLI" run-code "await page.waitForLoadState('domcontentloaded'); try { await page.waitForLoadState('networkidle', { timeout: 3000 }); } catch {} await page.waitForTimeout(400);" >/dev/null
  "$PWCLI" snapshot >"$OUTPUT_DIR/${route_name}-snapshot.md"
  if [[ -n "$expected_text" ]]; then
    assert_page_contains "$route_name" "$expected_text"
  fi
  if [[ -n "$expected_path_fragment" ]]; then
    assert_path_contains "$route_name" "$expected_path_fragment"
  fi
  assert_console_clean "$route_name"
  assert_network_clean "$route_name"
}

echo "QA Browser Smoke started."

ensure_api_server
ensure_web_server

check_route "pedidos" "/pedidos" "Agenda"
check_route "clientes" "/clientes" "Clientes"
check_route "produtos" "/produtos" "" "/estoque"
check_route "estoque" "/estoque" "" "/estoque"

echo "QA Browser Smoke OK (${WEB_URL})"
