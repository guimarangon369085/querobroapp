#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./scripts/kill-ports.sh
pnpm --filter @querobroapp/shared build
pnpm --filter @querobroapp/api prisma:migrate:dev

# Start API and Web in background
pnpm --filter @querobroapp/api dev > /tmp/querobroapp-api.log 2>&1 &
API_PID=$!

pnpm --filter @querobroapp/web dev > /tmp/querobroapp-web.log 2>&1 &
WEB_PID=$!

cat <<EOF
API PID: $API_PID (logs: /tmp/querobroapp-api.log)
WEB PID: $WEB_PID (logs: /tmp/querobroapp-web.log)
URL: http://127.0.0.1:3000
EOF

wait
