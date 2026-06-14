-- DB-level safety net for renewal history snapshots.
--
-- Renewal "snapshot" rows (renewed_from_transaction_id IS NOT NULL) are a record
-- of a closed past cycle and must never be summed into any total. Every
-- aggregating reader already filters them out in app code, but that relies on
-- each query remembering to. This view is the structural backstop: the
-- aggregating reads query it instead of the base table, so a snapshot can't be
-- counted even if a future query forgets the filter.
--
-- security_invoker = true is REQUIRED: without it the view would run as its
-- owner and bypass the base table's row-level security, exposing other users'
-- rows. With it, the caller's `user_id = auth.uid()` policy on
-- investment_transactions applies as normal.
--
-- Writes and the goal-detail History tab (which intentionally shows snapshots
-- via ?include_history=true) keep using the base table directly.
CREATE OR REPLACE VIEW active_investment_transactions
  WITH (security_invoker = true) AS
  SELECT * FROM investment_transactions
  WHERE renewed_from_transaction_id IS NULL;

GRANT SELECT ON active_investment_transactions TO authenticated;
