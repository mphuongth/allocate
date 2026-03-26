CREATE TABLE plan_other_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount_vnd BIGINT NOT NULL CHECK (amount_vnd > 0),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE plan_other_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plan other expenses"
  ON plan_other_expenses FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM monthly_plans
      WHERE monthly_plans.id = plan_other_expenses.plan_id
        AND monthly_plans.user_id = auth.uid()
    )
  );
