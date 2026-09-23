-- =========================================================================
-- 0003_orders_and_suborders.sql — orders, subscriptions, sub_orders
--
-- Order is the payment envelope. SubOrder is the unit of fulfillment, and the
-- only thing ops ever transitions. Sibling sub-orders never touch each other.
-- =========================================================================

CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  subtotal_paise        BIGINT NOT NULL CHECK (subtotal_paise >= 0),
  discount_amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount_paise >= 0),
  tax_paise             BIGINT NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_amount_paise    BIGINT NOT NULL CHECK (total_amount_paise >= 0),

  payment_status        order_payment_status NOT NULL DEFAULT 'pending',
  coupon_id             UUID REFERENCES coupons(id),
  source                order_source NOT NULL DEFAULT 'self_serve',

  placed_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The order total is always internally consistent, whatever produced it
  -- (self-serve checkout today, admin manual entry later).
  CONSTRAINT orders_total_is_derived CHECK (
    total_amount_paise = subtotal_paise - discount_amount_paise + tax_paise
  ),
  CONSTRAINT orders_discount_within_subtotal CHECK (
    discount_amount_paise <= subtotal_paise
  )
);

CREATE INDEX orders_user_placed_idx ON orders (user_id, placed_at DESC);
CREATE INDEX orders_payment_status_idx ON orders (payment_status);
CREATE INDEX orders_source_idx ON orders (source);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE subscriptions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id                 UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  frequency                  subscription_frequency NOT NULL,
  status                     subscription_status NOT NULL DEFAULT 'active',

  -- Price is LOCKED at subscription creation. Later catalog price changes do
  -- not affect an active subscription's per-delivery debit.
  per_delivery_price_paise   BIGINT NOT NULL CHECK (per_delivery_price_paise > 0),
  -- What the customer funded: the number of deliveries they are owed. Drives
  -- the open commitment that earmarks wallet money (see 0005_views.sql).
  total_deliveries_committed INTEGER NOT NULL CHECK (total_deliveries_committed > 0),

  start_date                 DATE NOT NULL,
  end_date                   DATE,
  paused_from                DATE,
  paused_until               DATE,

  -- The checkout order that activated and funded this subscription.
  activation_order_id        UUID REFERENCES orders(id) ON DELETE RESTRICT,

  cancelled_at               TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT subscriptions_pause_window CHECK (
    paused_until IS NULL OR (paused_from IS NOT NULL AND paused_until >= paused_from)
  ),
  CONSTRAINT subscriptions_end_after_start CHECK (
    end_date IS NULL OR end_date >= start_date
  ),
  CONSTRAINT subscriptions_cancelled_at_matches_status CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
  )
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id);
CREATE INDEX subscriptions_status_idx ON subscriptions (status);
-- The nightly generator scans this.
CREATE INDEX subscriptions_due_idx ON subscriptions (status, start_date) WHERE status = 'active';

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE sub_orders (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id                UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  subscription_id           UUID REFERENCES subscriptions(id) ON DELETE RESTRICT,

  fulfillment_type          fulfillment_type NOT NULL,
  status                    sub_order_status NOT NULL DEFAULT 'pending',

  quantity                  INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_paise          BIGINT NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise          BIGINT NOT NULL CHECK (line_total_paise >= 0),

  -- true  = the checkout line that activates/funds a subscription (no delivery, no debit)
  -- false = everything else, including each individual subscription delivery
  is_subscription_activation BOOLEAN NOT NULL DEFAULT false,

  scheduled_for             TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  skip_reason               TEXT,

  status_updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sub_orders_line_total_is_derived CHECK (
    line_total_paise = unit_price_paise * quantity
  ),
  -- A 'scheduled' sub-order without a time is meaningless to the ops queue.
  CONSTRAINT sub_orders_scheduled_needs_time CHECK (
    fulfillment_type <> 'scheduled' OR scheduled_for IS NOT NULL
  ),
  -- subscription_id is present exactly when this is subscription work.
  CONSTRAINT sub_orders_subscription_link CHECK (
    (fulfillment_type = 'subscription_fulfillment') = (subscription_id IS NOT NULL)
  ),
  CONSTRAINT sub_orders_activation_is_subscription_work CHECK (
    NOT is_subscription_activation OR fulfillment_type = 'subscription_fulfillment'
  ),
  -- delivered_at is set if and only if the status is 'delivered'.
  CONSTRAINT sub_orders_delivered_at_matches_status CHECK (
    (status = 'delivered') = (delivered_at IS NOT NULL)
  ),
  CONSTRAINT sub_orders_skip_reason_only_when_skipped CHECK (
    skip_reason IS NULL OR status = 'skipped'
  )
);

-- Exactly one activation line per subscription.
CREATE UNIQUE INDEX sub_orders_one_activation_per_subscription
  ON sub_orders (subscription_id)
  WHERE is_subscription_activation;

CREATE INDEX sub_orders_order_idx ON sub_orders (order_id);
CREATE INDEX sub_orders_subscription_idx ON sub_orders (subscription_id);
CREATE INDEX sub_orders_ops_queue_idx ON sub_orders (fulfillment_type, status);
CREATE INDEX sub_orders_scheduled_idx ON sub_orders (scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE TRIGGER sub_orders_set_updated_at
  BEFORE UPDATE ON sub_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keep status_updated_at honest without the application having to remember.
CREATE FUNCTION sub_orders_touch_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sub_orders_status_timestamp
  BEFORE UPDATE ON sub_orders
  FOR EACH ROW EXECUTE FUNCTION sub_orders_touch_status();
