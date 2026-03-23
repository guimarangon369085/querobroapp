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
SET "activePhoneKey" = TRIM("phone")
WHERE "id" IN (
  SELECT MIN("id")
  FROM "Customer"
  WHERE "deletedAt" IS NULL
    AND "phone" IS NOT NULL
    AND TRIM("phone") <> ''
  GROUP BY TRIM("phone")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_activePhoneKey_key" ON "Customer"("activePhoneKey");
CREATE INDEX IF NOT EXISTS "Customer_phone_idx" ON "Customer"("phone");

CREATE TABLE IF NOT EXISTS "PublicSequenceCounter" (
  "name" TEXT NOT NULL PRIMARY KEY,
  "nextValue" INTEGER NOT NULL
);

WITH ordered_customers AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "row_num"
  FROM "Customer"
)
UPDATE "Customer"
SET "publicNumber" = (
  SELECT ordered_customers."row_num"
  FROM ordered_customers
  WHERE ordered_customers."id" = "Customer"."id"
)
WHERE "publicNumber" IS NULL;

WITH ordered_orders AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "row_num"
  FROM "Order"
)
UPDATE "Order"
SET "publicNumber" = (
  SELECT ordered_orders."row_num"
  FROM ordered_orders
  WHERE ordered_orders."id" = "Order"."id"
)
WHERE "publicNumber" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_publicNumber_key" ON "Customer"("publicNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_publicNumber_key" ON "Order"("publicNumber");

INSERT INTO "PublicSequenceCounter" ("name", "nextValue")
VALUES (
  'customerPublicNumber',
  (SELECT COALESCE(MAX("publicNumber"), 0) + 1 FROM "Customer")
)
ON CONFLICT ("name") DO UPDATE
SET "nextValue" = EXCLUDED."nextValue";

INSERT INTO "PublicSequenceCounter" ("name", "nextValue")
VALUES (
  'orderPublicNumber',
  (SELECT COALESCE(MAX("publicNumber"), 0) + 1 FROM "Order")
)
ON CONFLICT ("name") DO UPDATE
SET "nextValue" = EXCLUDED."nextValue";
SQL
fi

exec pnpm --filter @querobroapp/api start:prod
