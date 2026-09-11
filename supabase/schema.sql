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
  total_amount NUMERIC NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'cancelled')),
  notes TEXT DEFAULT '',
  counter_name TEXT DEFAULT 'Main Pickup Counter #1',
  access_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Settings Table
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  event_name TEXT NOT NULL DEFAULT 'SpoonUp',
  currency_symbol TEXT NOT NULL DEFAULT '₹',
  admin_pin TEXT NOT NULL DEFAULT '1234',
  counter_name TEXT NOT NULL DEFAULT 'Main Shop',
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

-- 6. Initial Seed Settings
INSERT INTO settings (id, event_name, currency_symbol, admin_pin, counter_name)
VALUES (1, 'SpoonUp', '₹', '1234', 'Main Shop')
ON CONFLICT (id) DO NOTHING;

-- 7. Initial Seed Menu Products
INSERT INTO products (id, name, category, price, description, image_url, is_available)
VALUES
  ('prod-1', 'Pan Dry Fruit Gulkand Modak', 'Healthy Sweets', 70, 'Nutritious, delicious & guilt-free modak stuffed with aromatic pan, gulkand, and rich dry fruits. (Unit: Per Piece)', '/images/menu/modak.jpg', true),
  ('prod-2', 'Chocolate Protein Chia Pudding', 'Desserts', 425, 'Decadent chocolate protein chia pudding with dark chocolate shavings. No Added Sugar. (Unit: Per Piece/Jar)', '/images/menu/chia_pudding.jpg', true),
  ('prod-3', 'Dragonfruit Smoothie', 'Beverages', 250, 'Vibrant, antioxidant-rich dragonfruit smoothie with zero added sugar and chia seed topping. (Unit: Per Bottle)', '/images/menu/dragonfruit_smoothie.jpg', true),
  ('prod-4', 'Crispy Sabudana Sweet Potato Tikki with Chutney', 'Snacks', 180, 'Golden-crisp sabudana and sweet potato tikkis served with fresh coriander-mint chutney. (Unit: Per Plate)', '/images/menu/sabudana_tikki.jpg', true),
  ('prod-5', 'Peri Peri Healthy House Fries with Special Sauce', 'Snacks', 180, 'Crispy house-cut healthy fries tossed in aromatic peri-peri spices with house special dip. (Unit: Per Plate)', '/images/menu/peri_peri_fries.jpg', true),
  ('prod-6', 'Kashmiri Muesli', 'Healthy Breakfast', 500, 'Crunchy, tasty, snakable and great with milk. 100% natural, NO added sugar. (Unit: Per 100g)', '/images/menu/muesli.jpg', true),
  ('prod-7', 'Kashmir ke Almonds (100% Pure)', 'Kashmiri Dry Fruits', 1500, '100% Pure premium Kashmiri Almonds (Badam Giri), rich in natural oils and sweetness. (Unit: Per kg)', '/images/menu/almonds.jpg', true),
  ('prod-8', 'Kashmir ke Cashews (100% Pure)', 'Kashmiri Dry Fruits', 1800, '100% Pure jumbo Kashmiri Cashews (Kaju), naturally sweet, creamy, and crunchy. (Unit: Per kg)', '/images/menu/cashews.jpg', true),
  ('prod-9', 'Kashmir ke Walnuts (100% Pure)', 'Kashmiri Dry Fruits', 1600, '100% Pure premium Kashmiri Walnut Kernels (Akhrot Giri), rich in Omega-3. (Unit: Per kg)', '/images/menu/walnuts.jpg', true),
  ('prod-10', 'Kashmir ke Blackberries (100% Pure)', 'Kashmiri Dry Fruits', 1400, 'Sun-dried handpicked pure Kashmiri Blackberries / Berries, rich in natural antioxidants. (Unit: Per kg)', '/images/menu/blackberries.jpg', true),
  ('prod-11', '100% Pure Kashmiri Dry Fruits Assortment', 'Kashmiri Dry Fruits', 1650, 'Premium bowl assortment of Kashmiri Almonds, Cashews, Walnuts, and Blackberries. (Unit: Per 1 kg Bowl)', '/images/menu/dry_fruits.jpg', true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  price = EXCLUDED.price,
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url,
  is_available = EXCLUDED.is_available;

-- 8. Row Level Security (RLS) Policies
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Product Policies: Anyone can view active products
DROP POLICY IF EXISTS "Public can view products" ON products;
CREATE POLICY "Public can view products" ON products FOR SELECT USING (true);

-- Settings Policies: Public can read public event settings
DROP POLICY IF EXISTS "Public can view settings" ON settings;
CREATE POLICY "Public can view settings" ON settings FOR SELECT USING (true);

-- Order Policies:
-- Service role (backend API) has full access
-- Direct public users cannot freely query orders table without backend token validation
