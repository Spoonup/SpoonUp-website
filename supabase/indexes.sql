-- =========================================================================
-- SpoonUp: extra indexes for the live query patterns
-- Safe to re-run on an existing project (IF NOT EXISTS).
-- Paste into Supabase → SQL Editor → Run
-- =========================================================================

-- Admin order feed: filter by status, then sort newest first
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
  ON orders (status, created_at DESC);

-- Kitchen polling / last-updated lookups
CREATE INDEX IF NOT EXISTS idx_orders_updated_at
  ON orders (updated_at DESC);

-- Sequential pickup numbers must be unique (lookup by #101, #102, …)
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique
  ON orders (order_number);

-- Menu load orders products by created_at
CREATE INDEX IF NOT EXISTS idx_products_created_at
  ON products (created_at);

-- The unique access_token index already covers token lookups.
-- Drop the older non-unique duplicate if it exists.
DROP INDEX IF EXISTS idx_orders_access_token;
DROP INDEX IF EXISTS idx_orders_order_number;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type ON orders (fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_orders_payment_group_id ON orders (payment_group_id);

ANALYZE orders;
ANALYZE products;
ANALYZE settings;
