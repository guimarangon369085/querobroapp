ALTER TABLE "Coupon" ADD COLUMN "usageLimitPerCustomer" INTEGER;

ALTER TABLE "Order" ADD COLUMN "couponCode" TEXT;

CREATE INDEX "Order_customerId_couponCode_idx" ON "Order"("customerId", "couponCode");
CREATE INDEX "Order_couponCode_idx" ON "Order"("couponCode");
