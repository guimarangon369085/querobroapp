DROP INDEX IF EXISTS "Customer_email_idx";
DROP INDEX IF EXISTS "Customer_activeEmailKey_key";

ALTER TABLE "Customer" DROP COLUMN "email";
ALTER TABLE "Customer" DROP COLUMN "activeEmailKey";
