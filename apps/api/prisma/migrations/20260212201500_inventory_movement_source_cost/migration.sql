-- Add richer movement context for automated receipt ingestion.
ALTER TABLE "InventoryMovement" ADD COLUMN "source" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "sourceLabel" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN "unitCost" REAL;
