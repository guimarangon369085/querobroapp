#!/usr/bin/env bash
set -euo pipefail

PORTS=(3000 3001 8081)

if ! command -v lsof >/dev/null 2>&1; then
  echo "kill-ports: lsof nao encontrado."
  exit 1
fi

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

port_listener_pids() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

wait_for_port_clear() {
  local port="$1"
  local attempts="${2:-20}"
  local delay="${3:-0.25}"
  local i=1

  while [ "$i" -le "$attempts" ]; do
    if ! is_port_listening "$port"; then
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done

  return 1
}

signal_port_listeners() {
  local port="$1"
  local signal_name="$2"
  local pid

  while IFS= read -r pid; do
    [ -z "$pid" ] && continue
    kill "-${signal_name}" "$pid" >/dev/null 2>&1 || true
  done < <(port_listener_pids "$port")
}

clear_port() {
  local port="$1"
  local pids

  if ! is_port_listening "$port"; then
    echo "kill-ports: porta ${port} ja esta livre."
    return 0
  fi

  pids="$(port_listener_pids "$port" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  echo "kill-ports: encerrando listeners da porta ${port} (PID(s): ${pids:-desconhecido}) com TERM."
  signal_port_listeners "$port" TERM

  if wait_for_port_clear "$port"; then
    echo "kill-ports: porta ${port} liberada."
    return 0
  fi

  echo "kill-ports: porta ${port} ainda ocupada; escalando para KILL."
  signal_port_listeners "$port" KILL

  if wait_for_port_clear "$port"; then
    echo "kill-ports: porta ${port} liberada apos KILL."
    return 0
  fi

  echo "kill-ports: falha ao liberar porta ${port}."
  return 1
}

for port in "${PORTS[@]}"; do
  clear_port "$port"
done

echo "Ports 3000/3001/8081 cleared."
