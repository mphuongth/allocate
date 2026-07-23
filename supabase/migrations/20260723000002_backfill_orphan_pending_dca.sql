-- One-time backfill for pending seeded DCA rows orphaned by plan deletes that
-- happened BEFORE the 20260722000003 BEFORE-DELETE trigger existed (#472 follow-up).
--
-- That trigger removes a plan's pending seeded rows on delete, but it can only
-- match rows that still carry the plan id. Any plan deleted earlier already had
-- investment_transactions.plan_id set to NULL by the ON DELETE SET NULL FK, so
-- its pending seeded rows were left behind — planning artifacts with no plan
-- that still leak through the transaction/history and goal-stats APIs.
--
-- Remove those orphans now so the invariant holds for existing data too. The
-- filter is exactly a pending auto-seeded fund allocation with no plan:
--   is_dca_seeded  → only ever set on rows the seeding RPC created (always with a
--                    plan), so is_dca_seeded + plan_id IS NULL means the plan is gone
--   units IS NULL  → never recorded; a real purchase (units set) is preserved
-- A still-planned pending row keeps its plan_id (excluded), a recorded buy keeps
-- its units (excluded), and a manual fund tx is not is_dca_seeded (excluded).
delete from public.investment_transactions
 where plan_id is null
   and asset_type = 'fund'
   and is_dca_seeded
   and units is null;
