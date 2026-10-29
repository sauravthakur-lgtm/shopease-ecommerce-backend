-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" "CouponDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "minimumOrderAmount" DECIMAL(10,2),
    "maximumDiscountAmount" DECIMAL(10,2),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxTotalUses" INTEGER,
    "maxUsesPerCustomer" INTEGER,
    "currentUsageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE INDEX "Coupon_isActive_expiresAt_idx" ON "Coupon"("isActive", "expiresAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint
ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_code_format_check"
CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,49}$');

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_discount_value_check"
CHECK (
    "discountValue" > 0
    AND ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 100)
);

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_amount_limits_check"
CHECK (
    ("minimumOrderAmount" IS NULL OR "minimumOrderAmount" >= 0)
    AND ("maximumDiscountAmount" IS NULL OR "maximumDiscountAmount" > 0)
    AND ("discountType" = 'PERCENTAGE' OR "maximumDiscountAmount" IS NULL)
);

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_usage_limits_check"
CHECK (
    "currentUsageCount" >= 0
    AND ("maxTotalUses" IS NULL OR "maxTotalUses" >= "currentUsageCount")
    AND ("maxUsesPerCustomer" IS NULL OR "maxUsesPerCustomer" >= 1)
);

ALTER TABLE "Order"
ADD CONSTRAINT "Order_discount_amount_nonnegative_check"
CHECK ("discountAmount" >= 0);
