ALTER TABLE "Customer" ADD COLUMN "activeEmailKey" TEXT;
ALTER TABLE "Customer" ADD COLUMN "activePhoneKey" TEXT;

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

CREATE UNIQUE INDEX "Customer_activeEmailKey_key" ON "Customer"("activeEmailKey");
CREATE UNIQUE INDEX "Customer_activePhoneKey_key" ON "Customer"("activePhoneKey");
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");
