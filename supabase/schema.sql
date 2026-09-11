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
  ('prod-1', 'Cold Brew Coffee', 'Beverages', 120, 'Slow-steeped artisanal cold coffee served with chilled ice.', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?auto=format&fit=crop&w=400&q=80', true),
  ('prod-2', 'Special Masala Chai', 'Beverages', 40, 'Authentic hot spiced tea with cardamom, ginger, and aromatic spices.', 'https://images.unsplash.com/photo-1561336313-0bd5e0b27ec8?auto=format&fit=crop&w=400&q=80', true),
  ('prod-3', 'Crispy Paneer Wrap', 'Food', 160, 'Spiced paneer cubes, crunchy veggies & mint mayo rolled in a soft tortilla.', 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?auto=format&fit=crop&w=400&q=80', true),
  ('prod-4', 'Signature Veg Burger', 'Food', 140, 'Crispy vegetable patty with melted cheese, lettuce, tomatoes, and tangy sauce.', 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&w=400&q=80', true),
  ('prod-5', 'Peri Peri French Fries', 'Snacks', 90, 'Golden crispy potato fries tossed in fiery peri-peri seasoning.', 'https://images.unsplash.com/photo-1576107232684-1279f3908594?auto=format&fit=crop&w=400&q=80', true),
  ('prod-6', 'Rich Fudge Brownie', 'Desserts', 110, 'Decadent warm chocolate fudge brownie with chocolate drizzle.', 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=400&q=80', true)
ON CONFLICT (id) DO NOTHING;

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
