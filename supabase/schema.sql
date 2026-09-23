-- =========================================================================
-- Event Order-Taking System: Supabase PostgreSQL Production Schema
-- Copy and run this script in the Supabase SQL Editor (1-click setup)
-- =========================================================================

-- 1. Sequence for human-readable Order Numbers (Starts at 101)
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 101;

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  price NUMERIC NOT NULL CHECK (price >= 0),
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  is_available BOOLEAN NOT NULL DEFAULT true,
  deliver_later BOOLEAN NOT NULL DEFAULT false,
  gst_rate NUMERIC NOT NULL DEFAULT 5 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Orders Table (With Zero-Trust access_token to prevent IDOR / Neighboring leaks)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER NOT NULL DEFAULT nextval('order_number_seq'),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal_amount NUMERIC NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount NUMERIC NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'preparing', 'ready', 'completed', 'cancelled',
    'shipped', 'delivered', 'rejected', 'refunded'
  )),
  notes TEXT DEFAULT '',
  counter_name TEXT DEFAULT 'Main Pickup Counter #1',
  access_token TEXT NOT NULL,
  user_id TEXT,
  fulfillment_type TEXT NOT NULL DEFAULT 'immediate' CHECK (fulfillment_type IN ('immediate', 'delivery')),
  payment_group_id TEXT,
  payment_method TEXT NOT NULL DEFAULT 'counter' CHECK (payment_method IN ('counter', 'online')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  delivery_address JSONB,
  tracking_link TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  event_name TEXT NOT NULL DEFAULT 'SpoonUp',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  admin_username TEXT NOT NULL DEFAULT 'admin',
  -- NULL until the server bootstraps it from ADMIN_PASSWORD; never a default.
  admin_password TEXT,
  counter_name TEXT NOT NULL DEFAULT 'Main Shop',
  upi_id TEXT NOT NULL DEFAULT '',
  upi_phone TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_settings_row CHECK (id = 1)
);

-- 5. Performance & Security Indexes
CREATE INDEX IF NOT EXISTS idx_orders_access_token ON orders(access_token);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_fulfillment_type ON orders(fulfillment_type);
CREATE INDEX IF NOT EXISTS idx_orders_payment_group_id ON orders(payment_group_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_updated_at ON orders (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique ON orders (order_number);

-- 6. Initial Seed Settings
INSERT INTO settings (id, event_name, currency_symbol, admin_username, counter_name)
VALUES (1, 'SpoonUp', '₹', 'admin', 'Main Shop')
ON CONFLICT (id) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_access_token_unique ON orders(access_token);

-- 7. Initial Seed Menu Products
INSERT INTO products (id, name, category, price, description, image_url, is_available)
VALUES
  ('prod-1', 'Pan Dry Fruit Gulkand Modak', 'Healthy Sweets', 70, 'Nutritious, delicious & guilt-free modak stuffed with aromatic pan, gulkand, and rich dry fruits. (Unit: Per Piece)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-1.jpg', true),
  ('prod-2', 'Chocolate Protein Chia Pudding', 'Desserts', 425, 'Decadent chocolate protein chia pudding with dark chocolate shavings. No Added Sugar. (Unit: Per Piece/Jar)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-2.jpg', true),
  ('prod-3', 'Dragonfruit Smoothie', 'Beverages', 250, 'Vibrant, antioxidant-rich dragonfruit smoothie with zero added sugar and chia seed topping. (Unit: Per Bottle)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-3.jpg', true),
  ('prod-4', 'Crispy Sabudana Sweet Potato Tikki with Chutney', 'Snacks', 180, 'Golden-crisp sabudana and sweet potato tikkis served with fresh coriander-mint chutney. (Unit: Per Plate)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-4.jpg', true),
  ('prod-5', 'Peri Peri Healthy House Fries with Special Sauce', 'Snacks', 180, 'Crispy house-cut healthy fries tossed in aromatic peri-peri spices with house special dip. (Unit: Per Plate)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-5.jpg', true),
  ('prod-6', 'Kashmiri Muesli', 'Healthy Breakfast', 500, 'Crunchy, tasty, snakable and great with milk. 100% natural, NO added sugar. (Unit: Per 100g)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-6.jpg', true),
  ('prod-7', 'Kashmir ke Almonds (100% Pure)', 'Kashmiri Dry Fruits', 1500, '100% Pure premium Kashmiri Almonds (Badam Giri), rich in natural oils and sweetness. (Unit: Per kg)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-7.jpg', true),
  ('prod-8', 'Kashmir ke Cashews (100% Pure)', 'Kashmiri Dry Fruits', 1800, '100% Pure jumbo Kashmiri Cashews (Kaju), naturally sweet, creamy, and crunchy. (Unit: Per kg)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-8.jpg', true),
  ('prod-9', 'Kashmir ke Walnuts (100% Pure)', 'Kashmiri Dry Fruits', 1600, '100% Pure premium Kashmiri Walnut Kernels (Akhrot Giri), rich in Omega-3. (Unit: Per kg)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-9.jpg', true),
  ('prod-10', 'Kashmir ke Blackberries (100% Pure)', 'Kashmiri Dry Fruits', 1400, 'Sun-dried handpicked pure Kashmiri Blackberries / Berries, rich in natural antioxidants. (Unit: Per kg)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-10.jpg', true),
  ('prod-11', '100% Pure Kashmiri Dry Fruits Assortment', 'Kashmiri Dry Fruits', 1650, 'Premium bowl assortment of Kashmiri Almonds, Cashews, Walnuts, and Blackberries. (Unit: Per 1 kg Bowl)', 'https://storage.googleapis.com/spoonup-508319-product-images/products/catalog-prod-11.jpg', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url,
  is_available = EXCLUDED.is_available;

-- Customer accounts
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
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'fulfilling', 'paid', 'completed', 'failed', 'cancelled'
  )),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  delivery_address JSONB,
  -- References only ({id, fulfillmentType}); the orders table is the source of truth.
  created_orders JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower_unique ON users ((lower(username)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users ((lower(email)));
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_checkouts_razorpay_order_id ON checkouts(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_status_created_at ON checkouts (status, created_at DESC);
-- Exactly one order per (payment, fulfilment type): the database-level guard against
-- the webhook and the client both fulfilling the same payment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_fulfillment_unique
  ON orders (razorpay_payment_id, fulfillment_type)
  WHERE razorpay_payment_id IS NOT NULL AND razorpay_payment_id <> '';

-- 8. Row Level Security (RLS) Policies
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkouts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE products, orders, settings, users, user_sessions, checkouts FROM anon, authenticated, PUBLIC;

-- Existing databases: add new columns / constraints without dropping data.
ALTER TABLE products ADD COLUMN IF NOT EXISTS deliver_later BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS gst_rate NUMERIC NOT NULL DEFAULT 5;
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
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE checkouts ADD COLUMN IF NOT EXISTS tax_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_id TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS upi_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_username TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS admin_password TEXT;
ALTER TABLE settings DROP COLUMN IF EXISTS admin_pin;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'pending', 'preparing', 'ready', 'completed', 'cancelled',
  'shipped', 'delivered', 'rejected', 'refunded'
));

-- Browser clients must not read settings (admin credentials) or orders directly.
-- The Node backend uses the service role key, which bypasses RLS.
DROP POLICY IF EXISTS "Public can view products" ON products;
DROP POLICY IF EXISTS "Public can view settings" ON settings;

-- Order Policies:
-- Service role (backend API) has full access
-- Direct public users cannot freely query orders table without backend token validation
