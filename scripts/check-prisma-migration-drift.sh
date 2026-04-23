#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$PNPM_BIN" ]]; then
  echo "pnpm nao encontrado no PATH." >&2
  exit 1
fi

SHADOW_DB="$(mktemp /tmp/querobroapp-prisma-shadow.XXXXXX.db)"
cleanup() {
  rm -f "$SHADOW_DB"
}
trap cleanup EXIT INT TERM HUP

set +e
"$PNPM_BIN" --filter @querobroapp/api exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:${SHADOW_DB}" \
  --exit-code >/tmp/querobroapp-prisma-migrate-diff.log 2>&1
STATUS=$?
set -e

if [[ "$STATUS" -eq 0 ]]; then
  echo "Prisma migrations OK: schema.prisma e historico de migrations estao alinhados."
  exit 0
fi

if [[ "$STATUS" -eq 2 ]]; then
  echo "ERRO: schema.prisma divergiu do historico de migrations. Gere/registre a migration faltante antes de subir o ambiente." >&2
  echo "Sugestao: pnpm --filter @querobroapp/api exec prisma migrate dev --create-only --name <descricao-curta>" >&2
  echo "Resumo do diff salvo em /tmp/querobroapp-prisma-migrate-diff.log" >&2
  exit 1
fi

cat /tmp/querobroapp-prisma-migrate-diff.log >&2
echo "ERRO: falha ao validar drift entre migrations e schema Prisma." >&2
exit 1
