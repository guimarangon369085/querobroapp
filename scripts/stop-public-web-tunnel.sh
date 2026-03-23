#!/usr/bin/env bash
set -euo pipefail

PID_FILE="/tmp/querobroapp-public-web-tunnel.pid"
LOG_FILE="/tmp/querobroapp-public-web-tunnel.log"
URL_FILE="/tmp/querobroapp-public-web-tunnel.url"

if [ ! -f "$PID_FILE" ]; then
  echo "Nenhum tunnel publico do web em execucao."
  exit 0
fi

PID_VALUE="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -n "$PID_VALUE" ] && kill -0 "$PID_VALUE" >/dev/null 2>&1; then
  kill "$PID_VALUE" >/dev/null 2>&1 || true
  sleep 1
fi

rm -f "$PID_FILE" "$URL_FILE"
echo "Tunnel publico do web encerrado."
echo "Log mantido em: $LOG_FILE"
