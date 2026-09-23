-- =========================================================================
-- 0005_views.sql — derived balances, earmarking, reconciliation
--
-- Two different balances exist and using the wrong one is the easiest way to
-- get this system's money wrong:
--
--   ledger_balance   = every rupee actually in the wallet.
--   available_balance = ledger_balance MINUS money already promised to active
--                       subscriptions (the "earmark" from plan Flow 2).
--
-- Rule of thumb:
--   * A SUBSCRIPTION DELIVERY debit checks LEDGER balance. The commitment it
--     would net against is its own; checking available would double-count it
--     and skip a delivery the customer already paid for.
--   * Any OTHER spend (wallet-as-payment at checkout, admin refund) checks
--     AVAILABLE balance, so it cannot eat money owed to a subscription.
-- =========================================================================

-- Ledger truth, plus drift against the cached column.
CREATE VIEW wallet_ledger_balances AS
SELECT
  w.id                                             AS wallet_id,
  w.user_id,
  COALESCE(SUM(t.amount_paise), 0)::BIGINT         AS ledger_balance_paise,
  w.balance_cached_paise,
  COALESCE(SUM(t.amount_paise), 0)::BIGINT
    - w.balance_cached_paise                       AS drift_paise,
  COUNT(t.id)                                      AS transaction_count,
  MAX(t.created_at)                                AS last_transaction_at
FROM wallets w
LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
GROUP BY w.id, w.user_id, w.balance_cached_paise;

COMMENT ON VIEW wallet_ledger_balances IS
  'Source-of-truth balance recomputed from the ledger. drift_paise must be 0; any other value means a cache write escaped its transaction.';


-- How much money each still-running subscription has a claim on.
-- Deliveries already made have been debited, so only the remaining ones are
-- still earmarked. Cancelled/completed subscriptions release their claim.
CREATE VIEW subscription_open_commitments AS
SELECT
  s.id                       AS subscription_id,
  s.user_id,
  s.status,
  s.per_delivery_price_paise,
  s.total_deliveries_committed,
  COALESCE(d.delivered_count, 0)                              AS deliveries_made,
  GREATEST(s.total_deliveries_committed
           - COALESCE(d.delivered_count, 0), 0)               AS deliveries_remaining,
  (s.per_delivery_price_paise
   * GREATEST(s.total_deliveries_committed
              - COALESCE(d.delivered_count, 0), 0))::BIGINT   AS open_commitment_paise
FROM subscriptions s
LEFT JOIN (
  SELECT subscription_id, COUNT(*) AS delivered_count
  FROM sub_orders
  WHERE status = 'delivered'
    AND is_subscription_activation = false
  GROUP BY subscription_id
) d ON d.subscription_id = s.id
WHERE s.status IN ('active', 'paused');

COMMENT ON VIEW subscription_open_commitments IS
  'Earmarked wallet money per subscription: remaining funded deliveries x locked per-delivery price. Paused subscriptions keep their claim; cancelled and completed ones release it.';


-- What the customer may actually spend on anything other than the
-- subscriptions that earmarked the money.
CREATE VIEW wallet_available_balances AS
SELECT
  b.wallet_id,
  b.user_id,
  b.ledger_balance_paise,
  COALESCE(c.committed_paise, 0)::BIGINT                       AS committed_paise,
  (b.ledger_balance_paise
   - COALESCE(c.committed_paise, 0))::BIGINT                   AS available_paise
FROM wallet_ledger_balances b
LEFT JOIN (
  SELECT user_id, SUM(open_commitment_paise) AS committed_paise
  FROM subscription_open_commitments
  GROUP BY user_id
) c ON c.user_id = b.user_id;

COMMENT ON VIEW wallet_available_balances IS
  'available_paise may go negative when a customer underfunds or overspends; that is a real state and is what drives low-balance nudges and skipped deliveries.';


-- Reconciliation: any row here is a bug that needs investigating before close of day.
CREATE VIEW wallet_reconciliation_exceptions AS
SELECT wallet_id, user_id, ledger_balance_paise, balance_cached_paise, drift_paise
FROM wallet_ledger_balances
WHERE drift_paise <> 0;


-- Payments reconciliation: gateway-successful topups that never produced a
-- ledger credit, or ledger credits with no successful topup behind them.
CREATE VIEW topup_reconciliation_exceptions AS
SELECT
  tp.id            AS topup_id,
  tp.wallet_id,
  tp.gateway,
  tp.gateway_order_id,
  tp.gateway_payment_id,
  tp.amount_paise,
  tp.status,
  t.id             AS wallet_transaction_id,
  CASE
    WHEN tp.status = 'success' AND t.id IS NULL           THEN 'captured_but_not_credited'
    WHEN tp.status <> 'success' AND t.id IS NOT NULL      THEN 'credited_but_not_captured'
    WHEN t.amount_paise IS DISTINCT FROM tp.amount_paise  THEN 'amount_mismatch'
  END AS exception_kind
FROM topups tp
LEFT JOIN wallet_transactions t
  ON t.topup_id = tp.id AND t.type = 'topup'
WHERE (tp.status = 'success') <> (t.id IS NOT NULL)
   OR (t.id IS NOT NULL AND t.amount_paise IS DISTINCT FROM tp.amount_paise);

COMMENT ON VIEW topup_reconciliation_exceptions IS
  'Keeps gateway reconciliation independent of the general ledger, per the TopUp/ledger separation.';
