#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DATABASE_URL_PROD:-}" ]; then
  export DATABASE_URL="$DATABASE_URL_PROD"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL nao configurada para o deploy da API."
  exit 1
fi

pnpm --filter @querobroapp/api exec prisma db push --schema prisma/schema.prod.prisma
exec pnpm --filter @querobroapp/api start:prod
