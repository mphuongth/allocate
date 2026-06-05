-- Link a DCA fund to a savings goal so recurring contributions have a target.
-- Nullable: a DCA fund with no goal is treated as "Unallocated". ON DELETE SET
-- NULL so removing a goal leaves the fund's DCA intact (falls back to Unallocated).
ALTER TABLE funds
  ADD COLUMN dca_goal_id UUID NULL REFERENCES savings_goals(goal_id) ON DELETE SET NULL;
