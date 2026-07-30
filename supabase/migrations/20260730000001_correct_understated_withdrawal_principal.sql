-- Repair the one withdrawal row left wrong by the #578 partial-withdrawal bug.
--
-- Until PR #584, a partial bank withdrawal converted the entered amount into a
-- fraction of the deposit's CURRENT VALUE (principal + projected interest) and
-- applied that fraction back to the principal:
--
--     principal_withdrawn = round(principal × entered / current_value)
--
-- lib/depositValuation subtracts the RECORDED principal from the holding, so the
-- wrong figure is durable: the deposit's remaining balance stays overstated for
-- good. #584 stops new bad rows; it cannot repair the ones already written.
--
-- An audit of every bank withdrawal found exactly one affected row. The other two
-- were full closes, where the old fraction was pinned at 1 and therefore recorded
-- the whole principal correctly — which is precisely why this bug survived: only a
-- PARTIAL withdrawal exposes it.
--
-- The row, on the 20,239,452 ₫ deposit in goal "Phát sinh":
--
--     recorded principal_withdrawn   4,333,849
--     correct principal_withdrawn    4,365,100   (what the user entered)
--     understated by                    31,251
--
-- 4,365,100 is not an estimate. Three independent facts agree on it:
--
--   1. The bank's own remaining principal after the withdrawal was 15,874,352,
--      and 20,239,452 − 4,365,100 = 15,874,352 exactly. The app currently
--      believes 20,239,452 − 4,333,849 = 15,905,603 — over by 31,251.
--   2. Replaying the old formula on the app value at the time (20,385,398)
--      reproduces the stored figure exactly:
--      round(20,239,452 × 4,365,100 / 20,385,398) = 4,333,849.
--   3. It is the amount named in the #578 report.
--
-- amount_vnd (4,366,416) is already correct — that is the cash the bank paid, and
-- the interest becomes 4,366,416 − 4,365,100 = 1,316 rather than the 32,567 the
-- wrong principal implied. interest_earned_vnd is null on this row, so nothing
-- else needs touching.
--
-- Expected effect: the deposit's remaining principal drops to the bank's figure,
-- and because the row is goal-linked with affects_progress = true, goal "Phát
-- sinh" loses that 31,251 ₫ of principal plus the projected interest on it. That
-- reduction is the correction, not a new discrepancy.
--
-- The WHERE clause pins both the id and the current wrong value, which makes this
-- safe to run anywhere and more than once:
--   * re-running after it has applied matches 0 rows,
--   * a manual fix beforehand is not overwritten,
--   * local and E2E databases, which have no such row, are unaffected.

update public.investment_transactions
set principal_withdrawn = 4365100
where transaction_id = 'e5cc50e5-392e-41ec-a023-fb3f03476a08'
  and transaction_type = 'withdrawal'
  and asset_type = 'bank'
  and principal_withdrawn = 4333849;
