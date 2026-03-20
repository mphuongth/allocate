CREATE TABLE plan_insurance_member_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES insurance_members(member_id) ON DELETE CASCADE,
  monthly_amount_override_vnd INTEGER NOT NULL CHECK (monthly_amount_override_vnd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, member_id)
);

ALTER TABLE plan_insurance_member_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own insurance overrides"
  ON plan_insurance_member_overrides
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM monthly_plans
      WHERE monthly_plans.id = plan_insurance_member_overrides.plan_id
        AND monthly_plans.user_id = auth.uid()
    )
  );
