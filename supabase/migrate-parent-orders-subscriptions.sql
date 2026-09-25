-- ============================================================================
-- Parent orders, sub-orders, order items, subscriptions and the wallet ledger.
--
-- Additive and idempotent. Every new column on an existing table is nullable or
-- defaulted, so this migration can be applied to a live database before the new
-- code ships and rolled back by dropping the new objects.
--
-- Run AFTER migrate-security-hardening.sql and migrate-admin-credentials.sql.
-- ============================================================================

-- ---------------------------------------------------------------- products --
ALTER TABLE products ADD COLUMN IF NOT EXISTS fulfillment_kind TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS lead_time_days INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS prep_minutes INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subscribable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sellable_once BOOLEAN NOT NULL DEFAULT true;

-- Backfill from the legacy boolean. Safe to re-run.
UPDATE products
   SET fulfillment_kind = CASE WHEN deliver_later THEN 'DELIVERY_IN_DAYS' ELSE 'IMMEDIATE' END
 WHERE fulfillment_kind IS NULL;

ALTER TABLE products ALTER COLUMN fulfillment_kind SET DEFAULT 'IMMEDIATE';

DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_fulfillment_kind_chk
    CHECK (fulfillment_kind IN ('IMMEDIATE','DELIVERY_IN_DAYS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------- parent_orders --
CREATE SEQUENCE IF NOT EXISTS parent_order_number_seq START 5001;

CREATE TABLE IF NOT EXISTS parent_orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL DEFAULT nextval('parent_order_number_seq'),
  user_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'WEB' CHECK (platform IN ('WEB','ANDROID','IOS','ADMIN')),
  source  TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (source IN ('CUSTOMER','ADMIN','SUBSCRIPTION_RUN')),
  items_subtotal NUMERIC NOT NULL DEFAULT 0 CHECK (items_subtotal >= 0),
  tax_total      NUMERIC NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  calculated_total NUMERIC NOT NULL DEFAULT 0 CHECK (calculated_total >= 0),
  negotiated_total NUMERIC CHECK (negotiated_total IS NULL OR negotiated_total >= 0),
  -- Generated: an admin supplies the agreed price, never the discount.
  negotiated_discount NUMERIC GENERATED ALWAYS AS
    (CASE WHEN negotiated_total IS NULL THEN 0 ELSE calculated_total - negotiated_total END) STORED,
  payable_total NUMERIC NOT NULL DEFAULT 0 CHECK (payable_total >= 0),
  payment_method TEXT NOT NULL DEFAULT 'counter' CHECK (payment_method IN ('counter','online')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
  razorpay_order_id TEXT DEFAULT '',
  razorpay_payment_id TEXT DEFAULT '',
  created_by_admin TEXT,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT parent_orders_negotiation_chk
    CHECK (negotiated_total IS NULL OR negotiated_total <= calculated_total)
);

-- ------------------------------------------------- orders become sub-orders --
ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id TEXT REFERENCES parent_orders(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sub_order_type TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_ship_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subscription_delivery_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS awb_number TEXT;

-- Backfill is for reporting and filtering only. The API keys the status machine
-- off parent_order_id, so an existing order (which has none) keeps the flat
-- legacy vocabulary it was created with and does not change behaviour.
UPDATE orders
   SET sub_order_type = CASE WHEN fulfillment_type = 'delivery'
                             THEN 'DELIVERY_IN_DAYS' ELSE 'IMMEDIATE' END
 WHERE sub_order_type IS NULL;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_sub_order_type_chk
    CHECK (sub_order_type IN ('IMMEDIATE','DELIVERY_IN_DAYS','SCHEDULED','SUBSCRIPTION_DELIVERY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Structural guarantee: a scheduled order can never be a subscription delivery,
-- and a subscription delivery can never exist without its plan.
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_subscription_pairing_chk
    CHECK ((sub_order_type = 'SUBSCRIPTION_DELIVERY') = (subscription_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The status CHECK must allow the per-type vocabularies.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending','preparing','ready','completed','cancelled',
  'shipped','delivered','rejected','refunded',
  'scheduled','sourcing','packed','out_for_delivery','failed_delivery',
  'returned','skipped','reversed'
));

CREATE INDEX IF NOT EXISTS idx_orders_parent_order_id ON orders (parent_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_sub_order_type  ON orders (sub_order_type);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for   ON orders (scheduled_for)
  WHERE scheduled_for IS NOT NULL;

-- ------------------------------------------------------------ order_items --
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  sub_order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  unit_price_snapshot NUMERIC NOT NULL CHECK (unit_price_snapshot >= 0),
  gst_rate_snapshot NUMERIC NOT NULL DEFAULT 5,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  base_amount NUMERIC NOT NULL CHECK (base_amount >= 0),
  tax_amount  NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total  NUMERIC NOT NULL CHECK (line_total >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_items_sub_order ON order_items (sub_order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product   ON order_items (product_id);

-- ----------------------------------------------------------- subscriptions --
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  product_id TEXT NOT NULL,
  parent_order_id TEXT REFERENCES parent_orders(id),
  wallet_id TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY','ALTERNATE_DAYS','TWICE_WEEKLY','WEEKLY')),
  duration_months INTEGER NOT NULL CHECK (duration_months >= 1),
  delivery_count  INTEGER NOT NULL CHECK (delivery_count >= 1),
  start_date DATE NOT NULL,
  unit_price_snapshot NUMERIC NOT NULL,
  gst_rate_snapshot   NUMERIC NOT NULL DEFAULT 5,
  tier_id_snapshot TEXT,
  discount_percent_snapshot NUMERIC NOT NULL DEFAULT 0,
  gross_amount NUMERIC NOT NULL,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  subtotal_amount NUMERIC NOT NULL,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL,
  per_delivery_amount NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS subscription_deliveries (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  scheduled_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','SKIPPED','GENERATED','FULFILLED','FAILED','REFUNDED')),
  sub_order_id TEXT REFERENCES orders(id),
  -- The ledger row that funded this delivery, for reconciliation.
  wallet_transaction_id TEXT,
  amount_due NUMERIC NOT NULL CHECK (amount_due >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, sequence_no)
);
CREATE INDEX IF NOT EXISTS idx_sub_deliveries_due
  ON subscription_deliveries (scheduled_date) WHERE status = 'PLANNED';

-- ------------------------------------------------------------------ wallet --
CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('PLAN','SPENDABLE')),
  subscription_id TEXT,
  is_withdrawable BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_kind_chk CHECK (
    (kind = 'PLAN' AND subscription_id IS NOT NULL AND is_withdrawable = false) OR
    (kind = 'SPENDABLE' AND subscription_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_wallets_user ON wallets (user_id);

-- Append-only ledger. No UPDATE, no DELETE: corrections are compensating rows.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id),
  direction TEXT NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  type TEXT NOT NULL CHECK (type IN (
    'SUBSCRIPTION_TOPUP','DELIVERY_DEBIT','DELIVERY_REVERSAL',
    'REFERRAL_BONUS','REFUND','ADMIN_ADJUSTMENT','EXPIRY'
  )),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  subscription_id TEXT,
  subscription_delivery_id TEXT,
  sub_order_id TEXT,
  parent_order_id TEXT,
  reason TEXT DEFAULT '',
  -- The duplicate guard: a retried credit or debit collides here and is a no-op.
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet ON wallet_transactions (wallet_id);

-- Balance is always derived, never a mutable column.
CREATE OR REPLACE VIEW wallet_balances AS
SELECT wallet_id,
       SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END) AS balance
  FROM wallet_transactions
 GROUP BY wallet_id;

-- ------------------------------------------------------------------- RLS ---
ALTER TABLE parent_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON parent_orders, order_items, subscriptions,
              subscription_deliveries, wallets, wallet_transactions
  FROM anon, authenticated;
