-- Add category as nullable so existing products and their relations are preserved.
ALTER TABLE "Product" ADD COLUMN "category" TEXT;

CREATE INDEX "Product_category_status_idx" ON "Product"("category", "status");
