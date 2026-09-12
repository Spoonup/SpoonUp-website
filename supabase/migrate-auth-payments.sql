-- =========================================================================
-- SpoonUp: auth, Razorpay checkout, and deliver-later orders
-- Paste into Supabase → SQL Editor → Run
-- Safe to re-run on an existing project (IF NOT EXISTS / DROP IF EXISTS).
-- =========================================================================

-- 1) Product flag
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS deliver_later BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC NOT NULL DEFAULT 5;

-- 2) Order fields for users, payments, and delivery
ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'immediate';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_group_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'counter';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_link TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC NOT NULL DEFAULT 0;

-- Existing orders predate separate tax storage; preserve their historical total as base.
UPDATE orders
SET subtotal_amount = total_amount
WHERE subtotal_amount = 0 AND total_amount > 0;

-- 3) Expand allowed order statuses (kitchen + delivery)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending', 'preparing', 'ready', 'completed', 'cancelled',
  'shipped', 'delivered', 'rejected', 'refunded'
));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_fulfillment_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_type_check
  CHECK (fulfillment_type IN ('immediate', 'delivery'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_check
  CHECK (payment_method IN ('counter', 'online'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'refunded'));

-- 4) Customer accounts
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS checkouts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT DEFAULT '',
  payment_method TEXT NOT NULL,
  subtotal_amount NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'open',
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  delivery_address JSONB,
  created_orders JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS tax_amount NUMERIC NOT NULL DEFAULT 0;

-- 5) Indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type ON orders(fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_orders_payment_group_id ON orders(payment_group_id);
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users ((lower(username)));
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users ((lower(email)));
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_razorpay_order_id ON checkouts(razorpay_order_id);

-- 6) Lock tables down (backend uses the service role key)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE products, orders, settings, users, user_sessions, checkouts FROM anon, authenticated, PUBLIC;
