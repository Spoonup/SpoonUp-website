-- ============================================================================
-- Carries cart intent through payment.
--
-- `checkouts.items` stores the old verifiedItems shape, which has no purchase
-- mode, schedule or plan configuration. That means a subscription bought online
-- lost its configuration at /checkout/prepare — before the customer paid — so
-- fulfilment could only ever create plain orders and never fund a wallet.
--
-- cart_snapshot holds the fully built cart (parts, subscription intents,
-- totals) priced at prepare time, which is already the contract implied by
-- CHECKOUT_TTL_MS. Nullable: checkouts created before this deploy have none and
-- fall back to the legacy path, so nothing in flight breaks.
--
-- Additive and idempotent. Run AFTER migrate-parent-orders-subscriptions.sql.
-- ============================================================================

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS cart_snapshot JSONB;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS parent_order_id TEXT;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS platform TEXT;

CREATE INDEX IF NOT EXISTS idx_checkouts_parent_order ON checkouts (parent_order_id)
  WHERE parent_order_id IS NOT NULL;
