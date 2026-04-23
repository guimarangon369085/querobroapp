-- CreateTable
CREATE TABLE "OrderScheduleDayAvailability" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dayKey" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL DEFAULT 'ALL_DAY',
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankStatementImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "fileName" TEXT NOT NULL,
    "fileKind" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "emailSubject" TEXT,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "matchedPaymentsCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedInflowsCount" INTEGER NOT NULL DEFAULT 0,
    "inflowTotal" REAL NOT NULL DEFAULT 0,
    "outflowTotal" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankStatementClassificationOption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseCategory" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BankStatementTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "latestImportId" INTEGER,
    "bookedAt" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "externalId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "transactionKind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "classificationCode" TEXT,
    "manualClassification" BOOLEAN NOT NULL DEFAULT false,
    "manualMatch" BOOLEAN NOT NULL DEFAULT false,
    "counterpartyName" TEXT,
    "isOperational" BOOLEAN NOT NULL DEFAULT true,
    "matchedPaymentId" INTEGER,
    "matchedOrderId" INTEGER,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankStatementTransaction_latestImportId_fkey" FOREIGN KEY ("latestImportId") REFERENCES "BankStatementImport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Coupon" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT NOT NULL,
    "discountPct" REAL NOT NULL,
    "usageLimitPerCustomer" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Coupon" ("active", "code", "createdAt", "discountPct", "id", "updatedAt", "usageLimitPerCustomer")
SELECT "active", "code", "createdAt", "discountPct", "id", "updatedAt", "usageLimitPerCustomer" FROM "Coupon";
DROP TABLE "Coupon";
ALTER TABLE "new_Coupon" RENAME TO "Coupon";
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");
CREATE INDEX "Coupon_active_idx" ON "Coupon"("active");
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "price" REAL NOT NULL,
    "imageUrl" TEXT,
    "drawerNote" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "salesLimitEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salesLimitBoxes" INTEGER,
    "salesLimitActivatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Product" ("active", "category", "createdAt", "id", "imageUrl", "name", "price", "unit")
SELECT "active", "category", "createdAt", "id", "imageUrl", "name", "price", "unit" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE INDEX "Product_name_idx" ON "Product"("name");
CREATE INDEX "Product_category_idx" ON "Product"("category");
CREATE INDEX "Product_active_idx" ON "Product"("active");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OrderScheduleDayAvailability_dayKey_windowKey_isOpen_idx"
ON "OrderScheduleDayAvailability"("dayKey", "windowKey", "isOpen");

-- CreateIndex
CREATE UNIQUE INDEX "OrderScheduleDayAvailability_dayKey_windowKey_key"
ON "OrderScheduleDayAvailability"("dayKey", "windowKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementImport_checksum_key" ON "BankStatementImport"("checksum");

-- CreateIndex
CREATE INDEX "BankStatementImport_createdAt_idx" ON "BankStatementImport"("createdAt");

-- CreateIndex
CREATE INDEX "BankStatementImport_periodEnd_idx" ON "BankStatementImport"("periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementClassificationOption_code_key"
ON "BankStatementClassificationOption"("code");

-- CreateIndex
CREATE INDEX "BankStatementClassificationOption_active_sortOrder_idx"
ON "BankStatementClassificationOption"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementTransaction_externalId_key"
ON "BankStatementTransaction"("externalId");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_latestImportId_idx"
ON "BankStatementTransaction"("latestImportId");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_bookedAt_idx" ON "BankStatementTransaction"("bookedAt");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_category_bookedAt_idx"
ON "BankStatementTransaction"("category", "bookedAt");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_classificationCode_bookedAt_idx"
ON "BankStatementTransaction"("classificationCode", "bookedAt");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_matchedPaymentId_idx"
ON "BankStatementTransaction"("matchedPaymentId");

-- CreateIndex
CREATE INDEX "BankStatementTransaction_matchedOrderId_idx"
ON "BankStatementTransaction"("matchedOrderId");
