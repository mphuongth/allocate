-- Recurring-saving fulfillments — records that a recurring bank saving was
-- settled for a specific month by folding it into a maturing term deposit's
-- "settle & re-deposit" (Tất toán & gửi lại) combine renewal.
--
-- Why this exists: a recurring saving is a plan definition, not a logged row.
-- The dashboard normally suppresses its synthesized contribution when it finds a
-- logged bank deposit matching (month + goal + amount). But a combine renewal
-- folds this month's recurring amount INTO the (larger) re-deposit principal, so
-- the deposit's amount no longer equals the recurring amount and that
-- amount-based match can't fire. This table is the explicit, id+month match that
-- tells realizedRecurringContributions to skip the now-folded-in contribution —
-- the guard against counting that amount twice (once in the deposit, once as a
-- synthesized recurring row).

CREATE TABLE IF NOT EXISTS recurring_saving_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recurring_saving_id UUID NOT NULL REFERENCES recurring_savings(saving_id) ON DELETE CASCADE,
  ym TEXT NOT NULL CHECK (ym ~ '^\d{4}-\d{2}$'),
  amount_vnd BIGINT NOT NULL DEFAULT 0 CHECK (amount_vnd >= 0),
  source TEXT NOT NULL DEFAULT 'maturity-combine',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One fulfillment per saving per month — re-combining the same month upserts.
  UNIQUE (recurring_saving_id, ym)
);

ALTER TABLE recurring_saving_fulfillments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recurring_saving_fulfillments_select" ON recurring_saving_fulfillments
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "recurring_saving_fulfillments_insert" ON recurring_saving_fulfillments
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "recurring_saving_fulfillments_update" ON recurring_saving_fulfillments
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "recurring_saving_fulfillments_delete" ON recurring_saving_fulfillments
  FOR DELETE TO authenticated USING (user_id = auth.uid());
