-- Add new columns to investment_transactions.
-- fund_id links a fund transaction to its fund. It exists on the live database
-- but no committed migration ever created it (it was added out-of-band), so a
-- from-scratch replay (`supabase db reset` / fresh env / CI test project) failed
-- when the INSERT below references fund_id. Add it here so the migrations
-- faithfully reproduce production. Matches prod exactly: nullable uuid, no FK.
ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS fund_id UUID,
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES monthly_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- Migrate fund_investments → investment_transactions
INSERT INTO investment_transactions (
  user_id, goal_id, fund_id, asset_type, amount_vnd, units, unit_price,
  investment_date, plan_id, created_at, updated_at
)
SELECT
  user_id,
  goal_id,
  fund_id,
  'fund',
  amount_vnd,
  units_purchased,
  nav_at_purchase,
  COALESCE(investment_date, created_at::date),
  plan_id,
  created_at,
  updated_at
FROM fund_investments;

-- Migrate direct_savings → investment_transactions
INSERT INTO investment_transactions (
  user_id, goal_id, asset_type, amount_vnd, interest_rate, expiry_date,
  investment_date, plan_id, created_at, updated_at
)
SELECT
  user_id,
  goal_id,
  'bank',
  amount_vnd,
  profit_percent,
  expiry_date,
  created_at::date,
  plan_id,
  created_at,
  updated_at
FROM direct_savings;

-- Drop old tables
DROP TABLE IF EXISTS fund_investments;
DROP TABLE IF EXISTS direct_savings;
