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

if pnpm --filter @querobroapp/api exec prisma migrate deploy --schema prisma/schema.prod.prisma; then
  echo "Migrations aplicadas com prisma migrate deploy."
else
  echo "Falha no prisma migrate deploy; aplicando fallback controlado com db push."
  pnpm --filter @querobroapp/api exec prisma db push --accept-data-loss --schema prisma/schema.prod.prisma
  pnpm --filter @querobroapp/api exec prisma db execute --stdin --schema prisma/schema.prod.prisma <<'SQL'
UPDATE "Customer"
SET "activeEmailKey" = LOWER(TRIM("email"))
WHERE "id" IN (
  SELECT MIN("id")
  FROM "Customer"
  WHERE "deletedAt" IS NULL
    AND "email" IS NOT NULL
    AND TRIM("email") <> ''
  GROUP BY LOWER(TRIM("email"))
);

UPDATE "Customer"
SET "activePhoneKey" = TRIM("phone")
WHERE "id" IN (
  SELECT MIN("id")
  FROM "Customer"
  WHERE "deletedAt" IS NULL
    AND "phone" IS NOT NULL
    AND TRIM("phone") <> ''
  GROUP BY TRIM("phone")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_activeEmailKey_key" ON "Customer"("activeEmailKey");
CREATE UNIQUE INDEX IF NOT EXISTS "Customer_activePhoneKey_key" ON "Customer"("activePhoneKey");
CREATE INDEX IF NOT EXISTS "Customer_phone_idx" ON "Customer"("phone");
SQL
fi

exec pnpm --filter @querobroapp/api start:prod
