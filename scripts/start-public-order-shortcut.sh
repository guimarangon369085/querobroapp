#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export QUEROBROAPP_START_URL="http://127.0.0.1:3000/pedido"
exec ./scripts/start-desktop-app.sh
