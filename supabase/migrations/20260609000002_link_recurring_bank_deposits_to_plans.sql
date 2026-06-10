-- Backfill: link past recurring-saving bank deposits to their month's plan.
--
-- The Plan page's "Saved" action (PR #314) recorded a bank deposit toward a goal
-- but, before #315, POSTed it without a plan_id. The plan's By-goal view loads
-- contributions filtered by plan_id, so those deposits never counted — the goal
-- progress didn't move and the line still showed the "Saved" action.
--
-- Link only deposits that match a recurring-saving plan exactly (same user, goal
-- and amount) and fall in a month the user has a plan for. This is deliberately
-- conservative: manual term deposits / one-off savings that don't correspond to
-- a recurring plan are left untouched. Idempotent — re-running links nothing new
-- because matched rows no longer have a NULL plan_id.
UPDATE investment_transactions t
SET plan_id = p.id
FROM monthly_plans p
WHERE t.plan_id IS NULL
  AND t.transaction_type = 'investment'
  AND t.asset_type = 'bank'
  AND t.goal_id IS NOT NULL
  AND p.user_id = t.user_id
  AND p.month = EXTRACT(MONTH FROM t.investment_date)
  AND p.year  = EXTRACT(YEAR  FROM t.investment_date)
  AND EXISTS (
    SELECT 1 FROM recurring_savings r
    WHERE r.user_id = t.user_id
      AND r.goal_id IS NOT DISTINCT FROM t.goal_id
      AND r.amount_vnd = t.amount_vnd
  );
