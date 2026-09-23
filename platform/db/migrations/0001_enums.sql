-- =========================================================================
-- 0001_enums.sql — extensions and domain enums
--
-- Money convention for the entire platform schema: every monetary column is
-- BIGINT and holds PAISE (minor units). There are no NUMERIC or floating
-- point money columns anywhere, so no rounding helper can ever disagree with
-- the database.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('customer', 'admin');

-- How a sub-order reaches the customer. Drives which ops queue picks it up and
-- whether it settles against the wallet on delivery.
CREATE TYPE fulfillment_type AS ENUM (
  'delivery_days',            -- dry fruits / pantry, shipped over days
  'immediate',                -- ready-to-eat, earliest available slot
  'scheduled',                -- same-day, customer-chosen future time
  'subscription_fulfillment'  -- activation line, or one delivery under a subscription
);

-- One vocabulary across all fulfillment types. Not every type uses every value
-- (a dry-fruit sub-order never goes 'preparing'); the legal transitions per type
-- are enforced in application code, not here.
CREATE TYPE sub_order_status AS ENUM (
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'skipped',       -- subscription day not delivered (e.g. insufficient balance); NOT a cancellation
  'cancelled',
  'failed'
);

CREATE TYPE order_payment_status AS ENUM (
  'pending',
  'paid',
  'partially_paid',  -- split wallet + gateway
  'failed',
  'refunded'
);

CREATE TYPE order_source AS ENUM (
  'self_serve',
  'admin_manual',        -- reserved for the later manual-order-entry phase
  'subscription_cycle'   -- auto-generated, one per subscription delivery day
);

CREATE TYPE subscription_frequency AS ENUM ('daily', 'alternate_days', 'weekly');

CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'completed');

-- Ledger entry types. Sign is constrained per type in 0004_wallet.sql:
--   credits (+): topup, referral_bonus
--   debits  (-): subscription_debit, manual_refund
--   either  (±): manual_adjustment
-- There is deliberately no 'withdrawal' type and no customer-facing path that
-- can write manual_* rows.
CREATE TYPE wallet_txn_type AS ENUM (
  'topup',
  'subscription_debit',
  'referral_bonus',
  'manual_refund',
  'manual_adjustment'
);

CREATE TYPE topup_status AS ENUM ('created', 'pending', 'success', 'failed', 'expired');

CREATE TYPE payment_gateway AS ENUM ('razorpay', 'cashfree', 'ccavenue');

-- Shared updated_at maintenance.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
