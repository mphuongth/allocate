CREATE TABLE plan_excluded_insurance_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES insurance_members(member_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, member_id)
);

ALTER TABLE plan_excluded_insurance_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own exclusions"
  ON plan_excluded_insurance_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM monthly_plans
      WHERE monthly_plans.id = plan_excluded_insurance_members.plan_id
        AND monthly_plans.user_id = auth.uid()
    )
  );
