-- Realized interest captured per term-deposit renewal.
--
-- When a deposit is renewed, the user enters the interest actually received for
-- the cycle that just closed. We store that amount on the history snapshot row
-- (the one carrying renewed_from_transaction_id) so the goal-detail view can
-- show a truthful "renewed N times · total interest received X" summary.
--
-- Nullable on purpose: a null means "not recorded for this cycle" (e.g. an older
-- snapshot), which the summary surfaces as a ≥ / — rather than counting it as 0,
-- so the total is never silently understated.
ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS interest_earned_vnd BIGINT;
