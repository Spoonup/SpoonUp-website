-- ============================================================================
-- Payments journal, platform pricing, coupons and referrals.
-- Additive and idempotent. Run AFTER migrate-parent-orders-subscriptions.sql.
-- ============================================================================

-- ---------------------------------------------------------------- payments --
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  parent_order_id TEXT,
  checkout_id TEXT,
  gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
  gateway_order_id TEXT UNIQUE,
  gateway_payment_id TEXT UNIQUE,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  method_detail TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED','AUTHORIZED','CAPTURED','FAILED','REFUNDED','PARTIALLY_REFUNDED'
  )),
  failure_reason TEXT DEFAULT '',
  captured_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_parent ON payments (parent_order_id);

-- Webhook journal. The unique event id is the duplicate-delivery guard: Razorpay
-- redelivers freely, and a replay must be a cheap no-op with an audit trail.
CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  gateway TEXT NOT NULL DEFAULT 'RAZORPAY',
  gateway_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  gateway_payment_id TEXT,
  gateway_order_id TEXT,
  result TEXT DEFAULT '',
  raw_payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT,
  gateway_refund_id TEXT UNIQUE,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  is_partial BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'CREATED',
  reason TEXT DEFAULT '',
  created_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -------------------------------------------------------- platform pricing --
CREATE TABLE IF NOT EXISTS platform_price_rules (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('WEB','ANDROID','IOS')),
  scope TEXT NOT NULL DEFAULT 'GLOBAL' CHECK (scope IN ('GLOBAL','CATEGORY','PRODUCT')),
  scope_ref TEXT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('PERCENT','FLAT')),
  adjustment_value NUMERIC NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_platform_rules_lookup
  ON platform_price_rules (platform, scope) WHERE is_active;

-- ----------------------------------------------------------------- coupons --
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  scope TEXT NOT NULL CHECK (scope IN ('GLOBAL','COHORT','SINGLE_USER')),
  single_user_id TEXT,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENT','FLAT')),
  discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
  max_discount_amount NUMERIC,
  min_order_amount NUMERIC NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  total_usage_limit INTEGER,
  per_user_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_user_limit >= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT coupons_single_user_chk
    CHECK ((scope = 'SINGLE_USER') = (single_user_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS coupon_cohort_members (
  coupon_id TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  PRIMARY KEY (coupon_id, user_id)
);

-- The redemption row IS the lock. Inserting it before the discount is applied
-- turns a concurrent double-spend into a unique violation on the loser.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES coupons(id),
  user_key TEXT NOT NULL,          -- user id, or a phone-derived key for guests
  parent_order_id TEXT,
  discount_applied NUMERIC NOT NULL CHECK (discount_applied >= 0),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One redemption per user per coupon while per_user_limit = 1.
  UNIQUE (coupon_id, user_key)
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id);

-- --------------------------------------------------------------- referrals --
CREATE TABLE IF NOT EXISTS referral_rules (
  id TEXT PRIMARY KEY,
  referrer_amount NUMERIC NOT NULL CHECK (referrer_amount >= 0),
  referred_amount NUMERIC NOT NULL CHECK (referred_amount >= 0),
  qualifying_event TEXT NOT NULL DEFAULT 'FIRST_ORDER_PAID',
  min_order_amount NUMERIC NOT NULL DEFAULT 0,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  -- One referral per referred person, ever: the guard against repeat rewards.
  referred_user_id TEXT NOT NULL UNIQUE,
  code_used TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','QUALIFIED','REWARDED','REJECTED')),
  qualifying_parent_order_id TEXT,
  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qualified_at TIMESTAMPTZ,
  -- Self-referral is impossible at the storage layer, not just in code.
  CONSTRAINT referrals_no_self_chk CHECK (referrer_user_id <> referred_user_id)
);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  referral_id TEXT NOT NULL UNIQUE REFERENCES referrals(id),
  referrer_txn_id TEXT,
  referred_txn_id TEXT,
  amount_referrer NUMERIC NOT NULL,
  amount_referred NUMERIC NOT NULL,
  rule_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------- RLS ---
ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds               ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_price_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons               ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_cohort_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals             ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON payments, payment_events, refunds, platform_price_rules,
              coupons, coupon_cohort_members, coupon_redemptions,
              referral_rules, referral_codes, referrals, referral_rewards
  FROM anon, authenticated;

-- Parent orders gain the money fields these systems write.
ALTER TABLE parent_orders ADD COLUMN IF NOT EXISTS coupon_id TEXT;
ALTER TABLE parent_orders ADD COLUMN IF NOT EXISTS coupon_code TEXT;
ALTER TABLE parent_orders ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE parent_orders ADD COLUMN IF NOT EXISTS platform_adjustment NUMERIC NOT NULL DEFAULT 0;
