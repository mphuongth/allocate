-- A recurring saving that has ENDED no longer blocks finishing a goal (#722).
--
-- ─── what was wrong ──────────────────────────────────────────────────────────
--
-- savings_goal_finish_blockers named EVERY recurring saving pointed at a goal,
-- running or not. A user whose "Vikki" saving ran to August and who had spent the
-- money the goal was for could not archive the goal in September: the sheet said
-- "Tiết kiệm định kỳ đang chảy vào mục tiêu này" — present tense, about something
-- that had stopped — and told them to stop it or point it elsewhere.
--
-- Neither instruction worked. Ending a saving does not clear the block (this
-- function only ever looked at goal_id), and there is nothing left to stop. The
-- only ways through were to unassign the goal or delete the saving — which
-- destroy the true record that this saving fed this goal, to work around a
-- limitation of the app. Worse, unassigning did not even fix what the block
-- existed for: those synthesized months simply moved to "Unallocated" and stayed
-- in net worth.
--
-- ─── the rule now ────────────────────────────────────────────────────────────
--
-- The blockers exist so a finish cannot silently change what happens NEXT month.
-- A saving whose window closed before this month cannot feed the goal again, so
-- it has no business refusing the finish. One whose window includes this month
-- still can, and still blocks.
--
-- The months it DID run are not lost and not double-counted. They are already
-- frozen into the goal's completion snapshot — the finish route values the goal
-- through the dashboard, which counts them — and lib/finance.ts stops
-- synthesizing a saving whose goal is completed, so they leave net worth at the
-- same moment they become the archived result. Reopening the goal reverses both
-- halves together.
--
-- Month granularity, and business_today() not current_date: the same comparison
-- lib/finance.ts makes when it decides which months a saving covers, in the same
-- timezone (Asia/Ho_Chi_Minh). Comparing dates instead would let a saving that
-- ended on the 2nd stop blocking on the 3rd, while the dashboard still credits it
-- for the whole month.
--
-- Everything else about the function is unchanged, and repeated verbatim because
-- create or replace takes the whole body.

create or replace function public.savings_goal_finish_blockers(p_goal_id uuid)
returns table (code text, label text)
language sql
security invoker
stable
set search_path = ''
as $$
  -- A recurring saving that can still reach this goal. An ENDED one is excluded
  -- (#722) — see the header: it cannot contribute another month, and the months
  -- it did run stop being synthesized when the goal is finished.
  select 'recurring_saving'::text, r.name
    from public.recurring_savings r
   where r.goal_id = p_goal_id
     and (
       r.effective_to is null
       or date_trunc('month', r.effective_to)
          >= date_trunc('month', public.business_today())
     )
  union all
  -- ...and a saving that feeds a DEPOSIT held by this goal, whatever goal it is
  -- itself filed under. Nothing makes those two agree — the ownership trigger
  -- checks whose rows they are, not which goal — so a direct write, or a deposit
  -- reassigned to this goal afterwards, leaves a saving pointing here while its
  -- own goal_id says elsewhere.
  --
  -- Both shapes of link break, differently. A BOOK: the full close inside
  -- withdraw_accumulating_book clears every recurring link targeting the book it
  -- settles, regardless of goal, so the finish ends another goal's plan outright.
  -- A single term DEPOSIT: the link survives the liquidation, and now points at
  -- an empty deposit that has dropped out of the maturity flow — the saving can
  -- never be folded into the deposit it was promised to, while still showing as
  -- linked. Either way the finish has quietly changed what happens next month.
  --
  -- Not narrowed by the effective window: this is about a LINK the finish would
  -- break, not about future contributions, and an ended saving still holds it.
  select 'recurring_saving'::text, r.name
    from public.recurring_savings r
    join public.investment_transactions t
      on t.transaction_id = r.linked_deposit_tx_id
   where r.linked_deposit_tx_id is not null
     and t.goal_id = p_goal_id
     and r.goal_id is distinct from p_goal_id
  union all
  -- The same predicate seed_and_sync_plan_dca uses (20260722000001). A fund can
  -- keep dca_goal_id with is_dca off — disable_fund_dca clears both together, but
  -- only since 20260722000002, and the table takes the pair in any combination.
  -- Nothing is seeded from it, so nothing feeds the goal; blocking on it trapped
  -- the goal forever and named a fund whose DCA the user had already turned off.
  -- funds_dca_goal_not_completed is what stops it being switched back on later.
  select 'dca_plan'::text, f.name
    from public.funds f
   where f.dca_goal_id = p_goal_id
     and f.is_dca
     and f.dca_monthly_amount_vnd is not null
  union all
  -- A contribution dated in the FUTURE. POST /api/v1/investment-transactions
  -- allows one when it carries a plan_id — that is how next month's planned
  -- deposit is recorded before it happens — and it is a live holding from the
  -- moment it is written. Liquidating it would date the withdrawal before the
  -- purchase it draws on, and would settle a contribution the user has not made
  -- yet. Wait for it, or move it out of the goal.
  select 'future_holding'::text, coalesce(t.notes, t.investment_date::text)
    from public.investment_transactions t
   where t.goal_id = p_goal_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null
     and t.investment_date > public.business_today()
  union all
  -- Cash parked for a merge is money in the goal that is not a holding — it has
  -- no source row left to liquidate, so a finish would archive the goal on top of
  -- it. Consumed settlements are history and skipped (mirrors DELETE on the goal).
  select 'held_settlement'::text, coalesce(t.notes, '')
    from public.investment_transactions t
   where t.held_for_merge
     and t.consumed_by_inv_id is null
     and (t.goal_id = p_goal_id or t.merge_target_goal_id = p_goal_id)
  union all
  -- A book promised to a successor cannot be dissolved at all
  -- (enforce_successor_before_dissolve). Saying so up front beats letting the
  -- user fill in every figure and then hit the refusal on submit.
  select 'successor_handover'::text, coalesce(t.notes, '')
    from public.investment_transactions t
   where t.goal_id = p_goal_id
     and t.successor_deposit_tx_id is not null
     and t.deposit_group_id = t.transaction_id;
$$;

comment on function public.savings_goal_finish_blockers(uuid) is
  'Names everything that still feeds a goal and so blocks finishing it: recurring savings that can still run, DCA plans, held-for-merge cash, promised successor handovers (#650, #722).';
