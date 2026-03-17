ALTER TABLE "Customer" ADD COLUMN "publicNumber" INTEGER;
ALTER TABLE "Order" ADD COLUMN "publicNumber" INTEGER;

CREATE TABLE "PublicSequenceCounter" (
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

CREATE UNIQUE INDEX "Customer_publicNumber_key" ON "Customer"("publicNumber");
CREATE UNIQUE INDEX "Order_publicNumber_key" ON "Order"("publicNumber");

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
