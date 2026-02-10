-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "purchasePackSize" REAL NOT NULL,
    "purchasePackCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_InventoryItem" ("category", "createdAt", "id", "name", "purchasePackSize", "unit") SELECT "category", "createdAt", "id", "name", "purchasePackSize", "unit" FROM "InventoryItem";
DROP TABLE "InventoryItem";
ALTER TABLE "new_InventoryItem" RENAME TO "InventoryItem";
CREATE INDEX "InventoryItem_name_idx" ON "InventoryItem"("name");
CREATE INDEX "InventoryItem_category_idx" ON "InventoryItem"("category");
CREATE TABLE "new_InventoryMovement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "type" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InventoryMovement" ("createdAt", "id", "itemId", "quantity", "reason", "type") SELECT "createdAt", "id", "itemId", "quantity", "reason", "type" FROM "InventoryMovement";
DROP TABLE "InventoryMovement";
ALTER TABLE "new_InventoryMovement" RENAME TO "InventoryMovement";
CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");
CREATE INDEX "InventoryMovement_orderId_idx" ON "InventoryMovement"("orderId");
CREATE INDEX "InventoryMovement_createdAt_idx" ON "InventoryMovement"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
