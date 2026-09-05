-- The user's inflation assumption, and a per-goal override of it.
--
-- This is an ASSUMPTION, not a measurement. Vietnam's published CPI is a fact
-- about a year already lived; a goal maturing in 2030 depends on the average of
-- years nobody has lived yet. So the number stored here is the user's planning
-- position — it is never overwritten from a published figure, and no job may
-- move it. Nothing about recorded money depends on it either: it feeds a derived
-- view (what a target will cost, what idle savings are losing) and never a
-- balance, a target, or a progress ratio.
--
-- `user_settings` is deliberately general where `gold_price_settings` was
-- single-purpose: the next planning assumption belongs as a column here rather
-- than as another one-column table keyed on user_id.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- NULL is meaningful and is the default state: "I have not chosen", which the
  -- app answers with its own default. It is not the same as 0, which is a user
  -- saying "assume no inflation" — a position the app must keep.
  inflation_rate_pct NUMERIC(5,2)
    CHECK (inflation_rate_pct IS NULL OR (inflation_rate_pct >= 0 AND inflation_rate_pct <= 100)),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_settings_select" ON user_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "user_settings_insert" ON user_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_settings_update" ON user_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_settings_delete" ON user_settings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Per-goal override. CPI is an average over a basket nobody actually buys:
-- tuition and general consumer prices have not moved together, so a goal saving
-- for one should not be planned with the other's rate. NULL — the state every
-- existing goal starts in — means "use the user's rate".
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS inflation_rate_pct NUMERIC(5,2)
  CHECK (inflation_rate_pct IS NULL OR (inflation_rate_pct >= 0 AND inflation_rate_pct <= 100));
