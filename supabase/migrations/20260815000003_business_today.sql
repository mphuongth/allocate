-- Business dates in the database follow Vietnam, not the session's zone (#627).
--
-- #591 settled this for the app: there is exactly ONE business timezone,
-- Asia/Ho_Chi_Minh, every "today" comes from lib/dates wherever the code runs,
-- and an eslint rule blocks deriving one from UTC or the runtime's local zone.
-- The database was never brought under that rule. `show timezone` on a Supabase
-- stack is UTC — no migration sets it — so a `current_date` in a migration is a
-- UTC business date, the very idiom the lint rule refuses in TypeScript. Between
-- 00:00 and 06:59 Vietnam time the UTC date is still YESTERDAY.
--
-- #638 already started writing `(now() at time zone 'Asia/Ho_Chi_Minh')::date`
-- inline where it mattered (20260811000001, 20260812000001). This gives that
-- expression a name — the SQL counterpart of todayIso() — and points the
-- remaining live business dates at it.
--
-- ── what this changes ────────────────────────────────────────────────────────
--
--   1. insurance_savings.saved_date's DEFAULT. The route omits the column when
--      the client sends none (app/api/v1/insurance-savings), so the default IS
--      the business date for that request, and a contribution dated a day early
--      lands in the previous cycle — which is what isInCurrentCycle reads. The
--      current modal always sends a date, so this is the API contract rather
--      than a bug a user can hit through the UI today.
--   2. create_held_settlement's `coalesce(p_investment_date, current_date)`.
--      Latent: the only caller passes a validated date, so the fallback is a
--      trap for the next caller rather than a live bug.
--   3. savings_goal_finish_blockers' "is this holding still in the future?".
--      Live, and it fails CLOSED: in the 00:00–06:59 window a holding bought
--      TODAY reads as future, and the goal cannot be finished at all until the
--      session's date catches up.
--
-- ── what this deliberately does not change ───────────────────────────────────
--
-- Six functions guard against future-dating with `p_some_date > current_date + 1`:
-- collapse_accumulating_book, finish_savings_goal, record_recurring_book_topup,
-- renew_term_deposit, renew_term_deposit_with_merge, withdraw_accumulating_book.
--
-- The + 1 is a TOLERANCE, not a timezone conversion: it exists so a client whose
-- clock is a day ahead is not refused outright, and every route already applies
-- lib/dates' own future-date check with no grace before the call arrives. Under
-- the skew that guard only gets STRICTER — with the session a day behind,
-- `current_date + 1` is today, so it refuses a date it would otherwise allow. It
-- never admits one it should have refused, which is the promise a value guard
-- has to keep.
--
-- Correcting them would mean recreating six functions of 65–205 lines each to
-- change one token, and a copy whose next edit does not reach it is how this
-- schema has produced real bugs (#616's fund-bucket drift). So they are left,
-- and the decision is written down where it can be revisited: if the slack is
-- ever tightened, they move to business_today() in the same change.
-- supabase/tests/business_timezone.test.sql holds the allow-list, so a SEVENTH
-- one cannot appear quietly.
--
-- Issue #627 also named record_recurring_book_topup's
-- `v_anchor.expiry_date < current_date` maturity check. It is already gone:
-- 20260810000003/4 moved that comparison onto the ENTERED date
-- (assert_accumulating_book_topup_allowed measures expiry_date - p_top_up_date),
-- which is both timezone-free and the right question to ask.
--
-- now() / CURRENT_TIMESTAMP for created_at / updated_at is correct and untouched:
-- those are instants, not business dates — the same distinction lib/dates makes.

-- STABLE, not IMMUTABLE: the answer changes with the clock, so it must not be
-- folded into an index or cached across statements. Stable is also what lets it
-- serve as a column default and be read inside a plan.
--
-- search_path pinned like every other function here; the expression names both
-- schema-qualified pieces it needs, so an empty path costs nothing.
create or replace function public.business_today()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

comment on function public.business_today() is
  'Today in the one business timezone, Asia/Ho_Chi_Minh — the SQL counterpart of lib/dates todayIso() (#591/#627).';

-- Readable by everyone who writes a row that carries a business date. The column
-- default below is evaluated as the INSERTing role, so `authenticated` needs it
-- for an insurance contribution to be written at all.
grant execute on function public.business_today() to authenticated, anon, service_role;

-- ── 1) an insurance contribution is dated in Vietnam ─────────────────────────
alter table public.insurance_savings
  alter column saved_date set default public.business_today();

-- ── 2) a held settlement that names no date ──────────────────────────────────
--
-- Body identical to 20260731000001's except the coalesce fallback.

create or replace function public.create_held_settlement(
  p_source_id uuid,
  p_amount_vnd bigint,
  p_investment_date date default null,
  p_merge_target_goal_id uuid default null,
  p_merge_anchor_inv_id uuid default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Same ×10 sanity bound the multi-source merge already applies to a client's
  -- "received" (20260620000006). Settling a deposit releases its remaining
  -- principal plus interest, never a multiple of it. Deriving an exact cap would
  -- mean reimplementing lib/depositValuation's accrual in SQL and keeping the two
  -- in step forever; a bound generous enough never to refuse a real
  -- held-to-maturity value, but tight enough that the number cannot be invented,
  -- is the trade the merge path already made. Same rule in both places.
  v_src    public.investment_transactions;
  v_eff    bigint;
  v_target uuid;
  v_row    public.investment_transactions;
begin
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'held settlement: the amount received must be positive'
      using errcode = 'check_violation';
  end if;
  if p_source_id is null then
    raise exception 'held settlement: name the deposit this settles'
      using errcode = 'check_violation';
  end if;

  -- The lock is taken by THIS function rather than by the shared check: it is what
  -- makes two settlements of one deposit impossible, and taking it under RLS is
  -- also the ownership boundary — a source belonging to someone else is not
  -- visible here at all.
  select * into v_src
    from public.investment_transactions
   where transaction_id = p_source_id
   for update;
  if not found then
    raise exception 'held settlement: the deposit being settled was not found'
      using errcode = 'no_data_found';
  end if;

  -- Eligibility and the remaining principal come from the one definition every
  -- writer answers to. The amount bound is NOT checked here — the row trigger owns
  -- it, so there is one comparison rather than two that can drift.
  select remaining into v_eff from public.held_settlement_source_state(p_source_id);

  -- Net-worth safety. Closing the deposit removes it from net worth, and the
  -- pool adds the cash back ONLY through merge_target_goal_id. Unresolvable
  -- means the money leaves and is surfaced nowhere — so refuse rather than
  -- mis-state total assets. Defaulting to the source's own goal is what the app
  -- means by "stays where the deposit was".
  v_target := coalesce(p_merge_target_goal_id, v_src.goal_id);
  if v_target is null then
    raise exception 'held settlement: needs a target goal, or the parked cash leaves net worth with nothing to add it back to'
      using errcode = 'check_violation';
  end if;
  -- merge_target_goal_id is an app-managed mirror with no FK (20260620000004),
  -- so ownership is checked here rather than by a constraint.
  --
  -- insufficient_privilege, not check_violation: this is the #474/#525 rule that
  -- a caller may not point at another user's row, and the route turns it into the
  -- 403 every other cross-user reference in the API answers with. A malformed
  -- request and a forbidden one are different answers.
  perform 1 from public.savings_goals
   where goal_id = v_target and user_id = v_src.user_id;
  if not found then
    raise exception 'held settlement: the target goal does not belong to this deposit'
      using errcode = 'insufficient_privilege';
  end if;
  -- The two goal columns must agree, because two different readers use two
  -- different ones: the dashboard shows the parked cash under
  -- merge_target_goal_id, while renew_term_deposit_with_merge will only let a
  -- deposit consume a held row whose goal_id matches its own. Let them diverge
  -- and the settlement is displayed in one goal and consumable only from
  -- another — visible, and impossible to act on where it is visible.
  --
  -- So a settlement does not move cash between goals: an explicit target may
  -- only name the goal the deposit is already in. The one case where the target
  -- genuinely decides is a deposit with NO goal, where there is nothing to
  -- disagree with — and the row then takes the target as its own goal_id so both
  -- readers still agree.
  if v_src.goal_id is not null and v_target is distinct from v_src.goal_id then
    raise exception 'held settlement: the cash stays in the deposit''s own goal — it cannot be earmarked to a different one'
      using errcode = 'check_violation';
  end if;

  if p_merge_anchor_inv_id is not null then
    if p_merge_anchor_inv_id = p_source_id then
      raise exception 'held settlement: a deposit cannot wait to be merged into itself'
        using errcode = 'check_violation';
    end if;
    perform 1 from public.investment_transactions
     where transaction_id = p_merge_anchor_inv_id and user_id = v_src.user_id;
    if not found then
      raise exception 'held settlement: the anchor deposit does not belong to this deposit'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- "Để dành gộp" closes the deposit outright, so principal_withdrawn is the
  -- whole remaining principal — derived, never the client's number. The
  -- withdrawal invariant re-checks it against the same balance on the way in.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress,
    held_for_merge, merge_target_goal_id, merge_anchor_inv_id
  ) values (
    -- goal_id = v_target, not v_src.goal_id: they are equal whenever the source
    -- has a goal (checked above), and when it has none this is what keeps the
    -- row's goal and its display goal the same.
    v_src.user_id, v_target, 'bank', 'withdrawal', p_source_id,
    coalesce(p_investment_date, public.business_today()), p_amount_vnd, v_eff, true,
    true, v_target, p_merge_anchor_inv_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_held_settlement(uuid, bigint, date, uuid, uuid) to authenticated;

-- ── 3) a holding is "in the future" against the Vietnam date ─────────────────
--
-- Body identical to 20260813000002's except the future_holding predicate.

create or replace function public.savings_goal_finish_blockers(p_goal_id uuid)
returns table (code text, label text)
language sql
security invoker
stable
set search_path = ''
as $$
  -- EVERY recurring saving pointed at this goal, not only the ones still
  -- running. An ended one keeps contributing: the dashboard synthesizes a
  -- contribution for every realized plan month inside its window (there is no
  -- investment_transactions row — that is what #640 is about), and it adds them
  -- to the goal's value and to net worth forever. The finish RPC withdraws
  -- transactions, so it cannot liquidate that balance; archiving the goal on top
  -- of it would leave money permanently counted in a goal declared spent.
  -- Blocking is the honest answer: unassign or delete the saving first.
  select 'recurring_saving'::text, r.name
    from public.recurring_savings r
   where r.goal_id = p_goal_id
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
  'Names everything that still feeds a goal and so blocks finishing it: recurring savings, DCA plans, held-for-merge cash, promised successor handovers (#650).';
