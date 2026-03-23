CREATE TABLE "InventoryPriceEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemId" INTEGER NOT NULL,
    "purchasePackSize" REAL NOT NULL,
    "purchasePackCost" REAL NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "note" TEXT,
    "effectiveAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryPriceEntry_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "InventoryPriceEntry_itemId_effectiveAt_idx" ON "InventoryPriceEntry"("itemId", "effectiveAt");
CREATE INDEX "InventoryPriceEntry_effectiveAt_idx" ON "InventoryPriceEntry"("effectiveAt");
