ALTER TABLE "Coupon"
DROP CONSTRAINT "Coupon_usage_limits_check";

ALTER TABLE "Coupon"
ADD CONSTRAINT "Coupon_usage_limits_check"
CHECK (
    "currentUsageCount" >= 0
    AND ("maxTotalUses" IS NULL OR "maxTotalUses" >= 1)
    AND ("maxTotalUses" IS NULL OR "maxTotalUses" >= "currentUsageCount")
    AND ("maxUsesPerCustomer" IS NULL OR "maxUsesPerCustomer" >= 1)
);
