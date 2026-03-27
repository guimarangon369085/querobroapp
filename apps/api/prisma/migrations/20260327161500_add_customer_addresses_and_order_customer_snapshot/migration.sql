CREATE TABLE "CustomerAddress" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "address" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "placeId" TEXT,
    "lat" REAL,
    "lng" REAL,
    "deliveryNotes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CustomerAddress_customerId_isPrimary_idx" ON "CustomerAddress"("customerId", "isPrimary");
CREATE INDEX "CustomerAddress_customerId_createdAt_idx" ON "CustomerAddress"("customerId", "createdAt");
CREATE INDEX "CustomerAddress_placeId_idx" ON "CustomerAddress"("placeId");

ALTER TABLE "Order" ADD COLUMN "customerName" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerAddressLine1" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerAddressLine2" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerNeighborhood" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerCity" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerState" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPostalCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerCountry" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPlaceId" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerLat" REAL;
ALTER TABLE "Order" ADD COLUMN "customerLng" REAL;
ALTER TABLE "Order" ADD COLUMN "customerDeliveryNotes" TEXT;
