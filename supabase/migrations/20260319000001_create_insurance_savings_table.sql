-- insurance_savings
-- Records lump-sum savings contributions towards an insurance member's annual premium.
CREATE TABLE IF NOT EXISTS insurance_savings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  insurance_member_id UUID NOT NULL REFERENCES insurance_members(member_id) ON DELETE CASCADE,
  amount_saved_vnd BIGINT NOT NULL CHECK (amount_saved_vnd > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE insurance_savings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_savings_select" ON insurance_savings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "insurance_savings_insert" ON insurance_savings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "insurance_savings_delete" ON insurance_savings
  FOR DELETE TO authenticated USING (user_id = auth.uid());
