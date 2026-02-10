-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "Customer" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "Customer" ADD COLUMN "city" TEXT;
ALTER TABLE "Customer" ADD COLUMN "country" TEXT;
ALTER TABLE "Customer" ADD COLUMN "deliveryNotes" TEXT;
ALTER TABLE "Customer" ADD COLUMN "email" TEXT;
ALTER TABLE "Customer" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "lastName" TEXT;
ALTER TABLE "Customer" ADD COLUMN "lat" REAL;
ALTER TABLE "Customer" ADD COLUMN "lng" REAL;
ALTER TABLE "Customer" ADD COLUMN "neighborhood" TEXT;
ALTER TABLE "Customer" ADD COLUMN "placeId" TEXT;
ALTER TABLE "Customer" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Customer" ADD COLUMN "state" TEXT;

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");
