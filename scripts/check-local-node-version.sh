#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

STRICT_MODE=0
if [[ "${1:-}" == "--strict" ]]; then
  STRICT_MODE=1
fi

if [[ ! -f ".nvmrc" ]]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node nao encontrado no PATH." >&2
  exit 1
fi

REQUIRED_RAW="$(tr -d '[:space:]' < .nvmrc)"
REQUIRED_MAJOR="${REQUIRED_RAW%%.*}"
CURRENT_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
CURRENT_FULL="$(node -v)"

if [[ -z "$REQUIRED_MAJOR" || "$CURRENT_MAJOR" == "$REQUIRED_MAJOR" ]]; then
  echo "Node runtime OK: ${CURRENT_FULL} (requerido: ${REQUIRED_RAW})."
  exit 0
fi

MESSAGE="Node major atual=${CURRENT_MAJOR} (${CURRENT_FULL}), mas .nvmrc exige ${REQUIRED_RAW}. Use 'nvm use' antes do bootstrap para evitar drift de runtime."

if [[ "${QBAPP_SKIP_NODE_VERSION_CHECK:-}" == "1" ]]; then
  echo "WARN: ${MESSAGE} Ignorando porque QBAPP_SKIP_NODE_VERSION_CHECK=1." >&2
  exit 0
fi

if [[ "$STRICT_MODE" -eq 1 ]]; then
  echo "ERRO: ${MESSAGE}" >&2
  exit 1
fi

echo "WARN: ${MESSAGE}" >&2
