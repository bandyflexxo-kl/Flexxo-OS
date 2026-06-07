-- Add composite indexes for product listing queries
-- Covers: WHERE is_active=true AND is_visible_to_customers=true ORDER BY name
CREATE INDEX IF NOT EXISTS "idx_products_active_visible_name"
  ON "products" ("is_active", "is_visible_to_customers", "name");

-- Covers: WHERE is_active=true AND is_visible_to_customers=true AND category_id=?
CREATE INDEX IF NOT EXISTS "idx_products_active_visible_category"
  ON "products" ("is_active", "is_visible_to_customers", "category_id");
