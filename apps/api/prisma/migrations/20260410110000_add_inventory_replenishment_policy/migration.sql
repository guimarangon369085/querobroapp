ALTER TABLE "InventoryItem" ADD COLUMN "leadTimeDays" INTEGER;
ALTER TABLE "InventoryItem" ADD COLUMN "safetyStockQty" REAL;
ALTER TABLE "InventoryItem" ADD COLUMN "reorderPointQty" REAL;
ALTER TABLE "InventoryItem" ADD COLUMN "targetStockQty" REAL;
ALTER TABLE "InventoryItem" ADD COLUMN "perishabilityDays" INTEGER;
ALTER TABLE "InventoryItem" ADD COLUMN "criticality" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "preferredSupplier" TEXT;
