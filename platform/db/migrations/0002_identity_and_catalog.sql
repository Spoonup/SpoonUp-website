-- =========================================================================
-- 0002_identity_and_catalog.sql — users, products, coupons
--
-- These are the minimum tables the Order/SubOrder/Wallet models need to point
-- at. Auth (Google login), address book, and the full catalog are later phases.
-- =========================================================================

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,
  phone               TEXT,
  full_name           TEXT,
  role                user_role NOT NULL DEFAULT 'customer',
  referral_code       TEXT NOT NULL,
  referred_by_user_id UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT users_not_self_referred CHECK (referred_by_user_id IS DISTINCT FROM id)
);

CREATE UNIQUE INDEX users_email_lower_unique ON users ((lower(email)));
CREATE UNIQUE INDEX users_referral_code_unique ON users ((upper(referral_code)));
CREATE INDEX users_referred_by_idx ON users (referred_by_user_id);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'General',
  -- The product's natural fulfillment type. A sub-order may narrow it
  -- (an 'immediate' product ordered as 'scheduled'), so this is a default,
  -- not a constraint on the sub-order.
  fulfillment_type  fulfillment_type NOT NULL,
  price_paise       BIGINT NOT NULL CHECK (price_paise >= 0),
  gst_rate          NUMERIC(5,2) NOT NULL DEFAULT 5 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  is_subscribable   BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX products_active_category_idx ON products (category) WHERE is_active;
CREATE INDEX products_subscribable_idx ON products (is_subscribable) WHERE is_subscribable;

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Coupon LOGIC is a later phase. This table exists now only so orders.coupon_id
-- is a real foreign key rather than a dangling UUID we have to backfill later.
-- Scope/limit columns are present so the later phase is a logic change, not a
-- schema migration on a table that already has production rows.
CREATE TABLE coupons (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL,
  description        TEXT,
  scope              TEXT NOT NULL DEFAULT 'global',  -- global | cohort | single_user
  discount_paise     BIGINT CHECK (discount_paise IS NULL OR discount_paise >= 0),
  discount_percent   NUMERIC(5,2) CHECK (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100)),
  max_uses_total     INTEGER CHECK (max_uses_total IS NULL OR max_uses_total > 0),
  valid_from         TIMESTAMPTZ,
  valid_until        TIMESTAMPTZ,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT coupons_one_discount_kind CHECK (
    (discount_paise IS NOT NULL) <> (discount_percent IS NOT NULL)
  ),
  CONSTRAINT coupons_valid_window CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from
  )
);

CREATE UNIQUE INDEX coupons_code_upper_unique ON coupons ((upper(code)));

CREATE TRIGGER coupons_set_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
