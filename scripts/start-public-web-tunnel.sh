#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LOCAL_WEB_URL="${1:-http://127.0.0.1:3000}"
TOOLS_DIR="$ROOT_DIR/.tools/bin"
CLOUDFLARED_LOCAL_BIN="$TOOLS_DIR/cloudflared"
LOG_FILE="/tmp/querobroapp-public-web-tunnel.log"
PID_FILE="/tmp/querobroapp-public-web-tunnel.pid"
URL_FILE="/tmp/querobroapp-public-web-tunnel.url"

resolve_cloudflared_download_url() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os/$arch" in
    Darwin/x86_64)
      printf '%s\n' "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
      ;;
    Darwin/arm64)
      printf '%s\n' "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz"
      ;;
    Linux/x86_64|Linux/amd64)
      printf '%s\n' "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
      ;;
    Linux/arm64|Linux/aarch64)
      printf '%s\n' "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
      ;;
    *)
      echo "Plataforma sem suporte automatico para cloudflared: $os/$arch" >&2
      return 1
      ;;
  esac
}

ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    command -v cloudflared
    return 0
  fi

  if [ -x "$CLOUDFLARED_LOCAL_BIN" ]; then
    printf '%s\n' "$CLOUDFLARED_LOCAL_BIN"
    return 0
  fi

  mkdir -p "$TOOLS_DIR"
  local download_url tmp_dir archive_path extracted_bin
  download_url="$(resolve_cloudflared_download_url)"
  tmp_dir="$(mktemp -d)"
  archive_path="$tmp_dir/cloudflared-download"

  echo "Baixando cloudflared..."
  curl -fsSL "$download_url" -o "$archive_path"

  case "$download_url" in
    *.tgz)
      tar -xzf "$archive_path" -C "$tmp_dir"
      extracted_bin="$tmp_dir/cloudflared"
      ;;
    *)
      extracted_bin="$archive_path"
      ;;
  esac

  install -m 755 "$extracted_bin" "$CLOUDFLARED_LOCAL_BIN"
  rm -rf "$tmp_dir"

  printf '%s\n' "$CLOUDFLARED_LOCAL_BIN"
}

stop_existing_tunnel() {
  if [ -f "$PID_FILE" ]; then
    local existing_pid
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      kill "$existing_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
    rm -f "$PID_FILE"
  fi
}

extract_public_url() {
  grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -n 1 || true
}

wait_for_public_url() {
  local attempts=60
  local i=1
  while [ "$i" -le "$attempts" ]; do
    local public_url
    public_url="$(extract_public_url)"
    if [ -n "$public_url" ]; then
      printf '%s\n' "$public_url"
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done

  echo "Timeout aguardando URL publica do tunnel." >&2
  return 1
}

if ! curl -fsS "${LOCAL_WEB_URL%/}/pedido" >/dev/null 2>&1; then
  echo "Web local nao respondeu em ${LOCAL_WEB_URL%/}/pedido" >&2
  exit 1
fi

CLOUDFLARED_BIN="$(ensure_cloudflared)"
stop_existing_tunnel
: > "$LOG_FILE"

nohup "$CLOUDFLARED_BIN" tunnel --no-autoupdate --url "$LOCAL_WEB_URL" >"$LOG_FILE" 2>&1 </dev/null &
echo $! > "$PID_FILE"

PUBLIC_URL="$(wait_for_public_url)"
printf '%s\n' "$PUBLIC_URL" > "$URL_FILE"

if ! curl -fsSIL "${PUBLIC_URL%/}/pedido" >/dev/null 2>&1; then
  echo "Tunnel abriu, mas a URL publica ainda nao respondeu em /pedido." >&2
  exit 1
fi

echo "Tunnel publico do web pronto."
echo "Base URL: $PUBLIC_URL"
echo "Pedido publico: ${PUBLIC_URL%/}/pedido"
echo "Google Forms bridge: ${PUBLIC_URL%/}/api/google-form"
echo "Log: $LOG_FILE"
echo "Parar: ./scripts/stop-public-web-tunnel.sh"
