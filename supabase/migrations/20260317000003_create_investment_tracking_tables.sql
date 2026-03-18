-- savings_goals
CREATE TABLE IF NOT EXISTS savings_goals (
  goal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, goal_name)
);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "savings_goals_select" ON savings_goals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "savings_goals_insert" ON savings_goals
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "savings_goals_update" ON savings_goals
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "savings_goals_delete" ON savings_goals
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- investment_transactions
CREATE TABLE IF NOT EXISTS investment_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id UUID REFERENCES savings_goals(goal_id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('fund', 'bank', 'stock', 'gold')),
  investment_date DATE NOT NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  unit_price NUMERIC,
  units NUMERIC,
  interest_rate NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE investment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "investment_transactions_select" ON investment_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "investment_transactions_insert" ON investment_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "investment_transactions_update" ON investment_transactions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "investment_transactions_delete" ON investment_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- fixed_expenses
CREATE TABLE IF NOT EXISTS fixed_expenses (
  expense_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expense_name TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fixed_expenses_select" ON fixed_expenses
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "fixed_expenses_insert" ON fixed_expenses
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "fixed_expenses_update" ON fixed_expenses
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "fixed_expenses_delete" ON fixed_expenses
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- insurance_members
CREATE TABLE IF NOT EXISTS insurance_members (
  member_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  annual_payment_vnd BIGINT NOT NULL CHECK (annual_payment_vnd > 0),
  monthly_premium_vnd BIGINT GENERATED ALWAYS AS (annual_payment_vnd / 12) STORED,
  payment_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE insurance_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_members_select" ON insurance_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insurance_members_insert" ON insurance_members
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "insurance_members_update" ON insurance_members
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "insurance_members_delete" ON insurance_members
  FOR DELETE TO authenticated USING (user_id = auth.uid());
