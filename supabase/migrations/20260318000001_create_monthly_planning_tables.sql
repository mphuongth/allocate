-- monthly_plans
CREATE TABLE IF NOT EXISTS monthly_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  salary_vnd BIGINT NOT NULL CHECK (salary_vnd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, month, year)
);

ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monthly_plans_select" ON monthly_plans
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "monthly_plans_insert" ON monthly_plans
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "monthly_plans_update" ON monthly_plans
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "monthly_plans_delete" ON monthly_plans
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- fund_investments
CREATE TABLE IF NOT EXISTS fund_investments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  goal_id UUID REFERENCES savings_goals(goal_id) ON DELETE SET NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  units_purchased NUMERIC NOT NULL CHECK (units_purchased > 0),
  nav_at_purchase NUMERIC NOT NULL CHECK (nav_at_purchase > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fund_investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fund_investments_select" ON fund_investments
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "fund_investments_insert" ON fund_investments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "fund_investments_update" ON fund_investments
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "fund_investments_delete" ON fund_investments
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- direct_savings
CREATE TABLE IF NOT EXISTS direct_savings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  goal_id UUID REFERENCES savings_goals(goal_id) ON DELETE SET NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  profit_percent NUMERIC,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE direct_savings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "direct_savings_select" ON direct_savings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "direct_savings_insert" ON direct_savings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "direct_savings_update" ON direct_savings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "direct_savings_delete" ON direct_savings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- fixed_expense_overrides
CREATE TABLE IF NOT EXISTS fixed_expense_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  fixed_expense_id UUID NOT NULL REFERENCES fixed_expenses(expense_id) ON DELETE CASCADE,
  monthly_amount_override_vnd BIGINT NOT NULL CHECK (monthly_amount_override_vnd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, fixed_expense_id)
);

ALTER TABLE fixed_expense_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fixed_expense_overrides_select" ON fixed_expense_overrides
  FOR SELECT TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "fixed_expense_overrides_insert" ON fixed_expense_overrides
  FOR INSERT TO authenticated
  WITH CHECK (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "fixed_expense_overrides_update" ON fixed_expense_overrides
  FOR UPDATE TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "fixed_expense_overrides_delete" ON fixed_expense_overrides
  FOR DELETE TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
