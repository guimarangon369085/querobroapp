-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "fulfillmentMode" TEXT NOT NULL DEFAULT 'DELIVERY',
    "subtotal" REAL NOT NULL DEFAULT 0,
    "deliveryFee" REAL NOT NULL DEFAULT 0,
    "deliveryProvider" TEXT NOT NULL DEFAULT 'NONE',
    "deliveryFeeSource" TEXT NOT NULL DEFAULT 'NONE',
    "deliveryQuoteStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "deliveryQuoteRef" TEXT,
    "deliveryQuoteExpiresAt" DATETIME,
    "discount" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "scheduledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("createdAt", "customerId", "discount", "id", "notes", "scheduledAt", "status", "subtotal", "total") SELECT "createdAt", "customerId", "discount", "id", "notes", "scheduledAt", "status", "subtotal", "total" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_fulfillmentMode_idx" ON "Order"("fulfillmentMode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
