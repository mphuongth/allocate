CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  total_assets BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, snapshot_date)
);

ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "net_worth_snapshots_select" ON net_worth_snapshots
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "net_worth_snapshots_insert" ON net_worth_snapshots
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "net_worth_snapshots_update" ON net_worth_snapshots
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
