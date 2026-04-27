ALTER TABLE "Product" ADD COLUMN "inventoryItemId" INTEGER;
ALTER TABLE "Product" ADD COLUMN "inventoryQtyPerSaleUnit" REAL;

CREATE UNIQUE INDEX "Product_inventoryItemId_key" ON "Product"("inventoryItemId");
