-- =========================================================================
-- 0004_wallet.sql — wallets, wallet_transactions (ledger), topups
--
-- wallet_transactions is the source of truth. wallets.balance_cached_paise is
-- a cache maintained inside the same transaction as every ledger insert, and
-- is reconcilable at any time against the ledger (see 0005_views.sql).
-- =========================================================================

CREATE TABLE wallets (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  -- DERIVED. Never write this except in the same transaction as the ledger row
  -- that justifies it. Recomputable from wallet_transactions at any moment.
  balance_cached_paise BIGINT NOT NULL DEFAULT 0 CHECK (balance_cached_paise >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER wallets_set_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE topups (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id           UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

  amount_paise        BIGINT NOT NULL CHECK (amount_paise > 0),
  status              topup_status NOT NULL DEFAULT 'created',

  gateway             payment_gateway NOT NULL,
  gateway_order_id    TEXT NOT NULL,
  gateway_payment_id  TEXT,
  gateway_signature   TEXT,
  gateway_payload     JSONB,
  failure_reason      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT topups_gateway_order_unique UNIQUE (gateway, gateway_order_id)
);

-- A captured payment id can only ever be recorded once, across all topups.
CREATE UNIQUE INDEX topups_gateway_payment_unique
  ON topups (gateway, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

CREATE INDEX topups_wallet_idx ON topups (wallet_id, created_at DESC);
CREATE INDEX topups_status_idx ON topups (status);

CREATE TRIGGER topups_set_updated_at
  BEFORE UPDATE ON topups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE wallet_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id            UUID NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  type                 wallet_txn_type NOT NULL,

  -- Signed. Positive credits the customer, negative debits them.
  amount_paise         BIGINT NOT NULL CHECK (amount_paise <> 0),
  -- Running balance immediately after this row was written. Makes a statement
  -- renderable without a window function and makes drift obvious.
  balance_after_paise  BIGINT NOT NULL CHECK (balance_after_paise >= 0),

  -- What caused this movement. Exactly one of these is set for automated types.
  sub_order_id         UUID REFERENCES sub_orders(id) ON DELETE RESTRICT,
  topup_id             UUID REFERENCES topups(id) ON DELETE RESTRICT,
  subscription_id      UUID REFERENCES subscriptions(id) ON DELETE RESTRICT,
  referred_user_id     UUID REFERENCES users(id) ON DELETE RESTRICT,

  -- Required for manual_* types. This is the DB-level guard that no
  -- customer-facing code path (which has no admin identity) can write them.
  created_by_admin_id  UUID REFERENCES users(id) ON DELETE RESTRICT,
  note                 TEXT,

  -- Lets webhook/retry paths be replayed safely.
  idempotency_key      TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Sign rules per type. manual_refund is a DEBIT: money leaving the wallet on
  -- an approved, admin-processed withdrawal (plan Part B, admin Flow 4).
  CONSTRAINT wallet_txn_sign_matches_type CHECK (
    (type = 'topup'              AND amount_paise > 0) OR
    (type = 'referral_bonus'     AND amount_paise > 0) OR
    (type = 'subscription_debit' AND amount_paise < 0) OR
    (type = 'manual_refund'      AND amount_paise < 0) OR
    (type = 'manual_adjustment')
  ),

  -- Admin-only types must carry the admin who authorised them.
  CONSTRAINT wallet_txn_manual_requires_admin CHECK (
    type NOT IN ('manual_refund', 'manual_adjustment') OR created_by_admin_id IS NOT NULL
  ),
  -- Automated types must NOT claim an admin author.
  CONSTRAINT wallet_txn_automated_has_no_admin CHECK (
    type IN ('manual_refund', 'manual_adjustment') OR created_by_admin_id IS NULL
  ),

  -- Every subscription debit is traceable to the exact delivery that caused it.
  CONSTRAINT wallet_txn_debit_links_sub_order CHECK (
    type <> 'subscription_debit' OR (sub_order_id IS NOT NULL AND subscription_id IS NOT NULL)
  ),
  CONSTRAINT wallet_txn_topup_links_topup CHECK (
    type <> 'topup' OR topup_id IS NOT NULL
  ),
  CONSTRAINT wallet_txn_referral_links_user CHECK (
    type <> 'referral_bonus' OR referred_user_id IS NOT NULL
  )
);

-- THE anti-double-debit guarantee: a sub-order can be charged to the wallet at
-- most once, enforced by the database rather than by application discipline.
CREATE UNIQUE INDEX wallet_txn_one_debit_per_sub_order
  ON wallet_transactions (sub_order_id)
  WHERE type = 'subscription_debit';

-- A topup credits the wallet at most once, however many times its webhook fires.
CREATE UNIQUE INDEX wallet_txn_one_credit_per_topup
  ON wallet_transactions (topup_id)
  WHERE type = 'topup';

-- One referral bonus per referred user, ever.
CREATE UNIQUE INDEX wallet_txn_one_bonus_per_referred_user
  ON wallet_transactions (referred_user_id)
  WHERE type = 'referral_bonus';

CREATE UNIQUE INDEX wallet_txn_idempotency_key_unique
  ON wallet_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX wallet_txn_statement_idx ON wallet_transactions (wallet_id, created_at DESC);
CREATE INDEX wallet_txn_type_idx ON wallet_transactions (type, created_at DESC);
CREATE INDEX wallet_txn_subscription_idx ON wallet_transactions (subscription_id);


-- ----------------------------------------------------------------------
-- Append-only enforcement.
-- A ledger that can be edited is not a ledger. Corrections are new
-- compensating rows (manual_adjustment), never edits or deletes.
-- ----------------------------------------------------------------------
CREATE FUNCTION wallet_transactions_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'wallet_transactions is append-only; % is not permitted. Write a compensating manual_adjustment row instead.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER wallet_transactions_no_update
  BEFORE UPDATE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_reject_mutation();

CREATE TRIGGER wallet_transactions_no_delete
  BEFORE DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION wallet_transactions_reject_mutation();

CREATE TRIGGER wallet_transactions_no_truncate
  BEFORE TRUNCATE ON wallet_transactions
  FOR EACH STATEMENT EXECUTE FUNCTION wallet_transactions_reject_mutation();
