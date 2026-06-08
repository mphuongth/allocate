-- Recurring bank savings — the master list of recurring direct-saving rules
-- (named bank/product, target goal, monthly amount, optional effective period).
-- Mirrors fixed_expenses: definitions persist across months, and the Plan's
-- per-month skip/override sit on top in recurring_saving_overrides (NOT here).

-- recurring_savings
CREATE TABLE IF NOT EXISTS recurring_savings (
  saving_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_id UUID REFERENCES savings_goals(goal_id) ON DELETE SET NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

ALTER TABLE recurring_savings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_savings_select" ON recurring_savings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "recurring_savings_insert" ON recurring_savings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "recurring_savings_update" ON recurring_savings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "recurring_savings_delete" ON recurring_savings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- recurring_saving_overrides — per-plan amount override / skip (0 = skip this month)
CREATE TABLE IF NOT EXISTS recurring_saving_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  recurring_saving_id UUID NOT NULL REFERENCES recurring_savings(saving_id) ON DELETE CASCADE,
  monthly_amount_override_vnd BIGINT NOT NULL CHECK (monthly_amount_override_vnd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, recurring_saving_id)
);

ALTER TABLE recurring_saving_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_saving_overrides_select" ON recurring_saving_overrides
  FOR SELECT TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "recurring_saving_overrides_insert" ON recurring_saving_overrides
  FOR INSERT TO authenticated
  WITH CHECK (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "recurring_saving_overrides_update" ON recurring_saving_overrides
  FOR UPDATE TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "recurring_saving_overrides_delete" ON recurring_saving_overrides
  FOR DELETE TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
