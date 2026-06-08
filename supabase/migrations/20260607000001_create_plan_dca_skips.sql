-- Per-plan fund-DCA skips — "skip this fund's DCA contribution this month".
-- Presence of a row = the fund's DCA is skipped for that monthly plan. Mirrors
-- the per-plan override/exclusion tables (plan-scoped RLS).

CREATE TABLE IF NOT EXISTS plan_dca_skips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES monthly_plans(id) ON DELETE CASCADE,
  fund_id UUID NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, fund_id)
);

ALTER TABLE plan_dca_skips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_dca_skips_select" ON plan_dca_skips
  FOR SELECT TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "plan_dca_skips_insert" ON plan_dca_skips
  FOR INSERT TO authenticated
  WITH CHECK (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
CREATE POLICY "plan_dca_skips_delete" ON plan_dca_skips
  FOR DELETE TO authenticated
  USING (plan_id IN (SELECT id FROM monthly_plans WHERE user_id = auth.uid()));
