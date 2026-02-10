#!/usr/bin/env bash
set -euo pipefail
lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill -9 || true
lsof -tiTCP:3001 -sTCP:LISTEN | xargs -r kill -9 || true
lsof -tiTCP:8081 -sTCP:LISTEN | xargs -r kill -9 || true
pkill -f "pnpm --filter @querobroapp/api dev" || true
pkill -f "pnpm --filter @querobroapp/web dev" || true
pkill -f "tsx watch src/main.ts" || true
pkill -f "next dev -H 127.0.0.1" || true

echo "Stopped dev servers and cleared ports."
