-- =========================================================================
-- SpoonUp: security & concurrency hardening
-- Paste into Supabase → SQL Editor → Run BEFORE deploying the matching server build.
-- Safe to re-run on an existing project (IF NOT EXISTS / DROP IF EXISTS).
-- =========================================================================

-- 1) One order per (payment, fulfilment type). This is the database-level guard that
--    makes concurrent fulfilment (webhook + client) idempotent even across instances.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_fulfillment_unique
  ON orders (razorpay_payment_id, fulfillment_type)
  WHERE razorpay_payment_id IS NOT NULL AND razorpay_payment_id <> '';

-- 2) Checkout lifecycle: the server now claims a checkout with status 'fulfilling'
--    before creating orders. Constrain the allowed values so a typo can never
--    leave a checkout in an unknown state.
ALTER TABLE checkouts DROP CONSTRAINT IF EXISTS checkouts_status_check;
ALTER TABLE checkouts ADD CONSTRAINT checkouts_status_check CHECK (status IN (
  'open', 'fulfilling', 'paid', 'completed', 'failed', 'cancelled'
));
CREATE INDEX IF NOT EXISTS idx_checkouts_status_created_at ON checkouts (status, created_at DESC);

-- 3) Case-insensitive uniqueness for accounts. Lookups already lower-case the value;
--    this makes the database enforce it too (the old non-unique indexes are replaced).
DROP INDEX IF EXISTS idx_users_username_lower;
DROP INDEX IF EXISTS idx_users_email_lower;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique ON users ((lower(username)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users ((lower(email)));

-- 4) Expired sessions are pruned on login; this index keeps that cheap.
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);

-- 5) UPI details move out of the client bundle into settings (admin-editable).
ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_phone TEXT NOT NULL DEFAULT '';

-- 6) Order polling by "updated since" for the admin dashboard.
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders (updated_at DESC);

ANALYZE orders;
ANALYZE checkouts;
ANALYZE users;
ANALYZE user_sessions;
