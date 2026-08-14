-- Finish a goal: liquidate every live holding and archive it at 100% (#650).
--
-- A goal can be genuinely DONE while its balance is zero — the user withdrew the
-- deposits, funds and gold to pay for the thing the goal was for. Today each of
-- those withdrawals lowers the percentage, and deleting the goal is worse: it
-- unlinks every transaction and loses the history.
--
-- So completion is a DECLARED OUTCOME, not a current balance. The goal keeps its
-- rows and its goal_id links; three snapshot columns record what it finished at,
-- and no later withdrawal can move them.
--
-- ─── Why the whole liquidation lives in one function ─────────────────────────
--
-- A finish writes one withdrawal per holding — several deposits, a book's worth
-- of tranches, a fund bucket, gold — and then the snapshot. Half of that is not a
-- state the ledger should ever be in: holdings gone with the goal still open, or
-- a goal archived at 100% with money still in it. supabase-js has no transaction,
-- so the route would have to fire the writes one at a time and hope. Here they
-- are one statement from the caller's side: any refusal — an invariant, a
-- successor promise, a stale plan — rolls the whole thing back.
--
-- ─── What it does NOT re-implement ───────────────────────────────────────────
--
-- Every withdrawal it writes goes through the ordinary table triggers:
-- check_withdrawal_balance (#587) measures each one against its holding,
-- enforce_user_scoped_fk_ownership (#525) re-checks the references, and a book is
-- closed by withdraw_accumulating_book itself, so the successor guard and the
-- recurring-link cleanup fire exactly as they do from the withdraw sheet. This
-- function decides WHICH holdings and HOW MUCH of each (all of it); the accounting
-- rules stay where they already are.

-- ── the completion snapshot ──────────────────────────────────────────────────
alter table public.savings_goals
  add column if not exists completed_at timestamptz,
  add column if not exists completion_value bigint,
  add column if not exists completion_percentage numeric;

comment on column public.savings_goals.completed_at is
  'When the goal was declared finished (#650). NULL = active. The goal keeps every goal_id link; only its live holdings are gone.';
comment on column public.savings_goals.completion_value is
  'The goal''s progress value at the moment it was finished — frozen, so later withdrawals cannot reduce a completed goal''s result (#650).';
comment on column public.savings_goals.completion_percentage is
  'The percentage the goal is archived at. 100 for the successful full-liquidation finish (#650); a "close early" outcome would record its own.';

-- Every completed goal has all three or none of them: a snapshot missing its
-- value renders as "Completed · —", which is worse than not being completed.
alter table public.savings_goals drop constraint if exists savings_goals_completion_snapshot_complete;
alter table public.savings_goals add constraint savings_goals_completion_snapshot_complete check (
  (completed_at is null and completion_value is null and completion_percentage is null)
  or (completed_at is not null and completion_value is not null and completion_percentage is not null)
);

create index if not exists savings_goals_active_idx
  on public.savings_goals (user_id) where completed_at is null;

-- ── the snapshot is written by the finish, not by anyone with a goal id ──────
--
-- The savings_goals UPDATE policy is row-scoped, not column-scoped, so a direct
-- Supabase client could stamp completed_at with any figures it liked while the
-- holdings stayed live. The goal would move to Completed showing a fabricated
-- result, and the freeze triggers would then lock that inconsistent ledger in
-- place — the worst of both.
--
-- Same shape as the successor-link guard (20260811000001): a transaction-local
-- flag the RPCs set, checked only for a real end user. auth.uid() is null for
-- the service role, for migrations and for SQL maintenance, which keep their
-- reach — the convention the rest of the schema uses.
create or replace function public.enforce_completion_written_by_rpc()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.completed_at is distinct from old.completed_at
      or new.completion_value is distinct from old.completion_value
      or new.completion_percentage is distinct from old.completion_percentage)
     and auth.uid() is not null
     and coalesce(current_setting('app.goal_completion_write', true), '') <> '1' then
    raise exception 'completed goal: a goal is finished through finish_savings_goal, not by writing the snapshot'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists savings_goals_completion_rpc_only on public.savings_goals;
create trigger savings_goals_completion_rpc_only
  -- INSERT too: a goal created already "completed" is the same fabrication by a
  -- shorter route. On an INSERT, OLD is null, so the comparisons below read as
  -- "the new row states a snapshot", which is exactly the question.
  before insert or update of completed_at, completion_value, completion_percentage
    on public.savings_goals
  for each row execute function public.enforce_completion_written_by_rpc();

-- Stated as a grant as well as enforced by the trigger. The trigger is what
-- actually refuses (a column grant does not survive every platform default), but
-- the revoke says the intent plainly to anyone reading the schema.
revoke insert (completed_at, completion_value, completion_percentage),
       update (completed_at, completion_value, completion_percentage)
  on public.savings_goals from anon, authenticated;

-- ── blockers ─────────────────────────────────────────────────────────────────
--
-- Finish must not silently alter what happens NEXT month. A recurring saving, a
-- DCA plan, cash parked for a merge or a promised successor handover all keep
-- feeding a goal after it is archived — the recurring top-up would even reopen a
-- book this function just closed. Rather than quietly unlinking them (the user's
-- plan, changed behind their back), the finish is refused and each one is NAMED
-- so the user can stop or reassign it.
--
-- Read-only and its own function so the sheet can list them BEFORE the user fills
-- in a single realization figure, and the finish itself re-checks the same rules
-- under the goal's lock. Two readers, one definition.
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
  select 'dca_plan'::text, f.name
    from public.funds f
   where f.dca_goal_id = p_goal_id
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
     and t.investment_date > current_date
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

-- The live tranches of a book and what each still holds. Extracted from
-- withdraw_accumulating_book so the function can be called twice in one
-- transaction (see below) and so the finish RPC measures a book exactly the way
-- the close does.
--
-- A withdrawal keyed by a fund draws on that (goal, fund) bucket, not on the
-- tranche it names as parent — the precedence check_withdrawal_balance applies
-- (#606), for a shape the POST route accepts and older rows carry.
-- savings_goal_live_holdings already excludes those rows, so the plan the user
-- confirms carries the book's full principal; counted here the close measured a
-- smaller book and refused that plan as an overdraw. A goal holding one of these
-- rows could not be finished at all.
create or replace function public.book_live_tranches(p_book_id uuid)
returns table (transaction_id uuid, user_id uuid, goal_id uuid, investment_date date, eff bigint)
language sql
security invoker
stable
set search_path = ''
as $$
  select t.transaction_id, t.user_id, t.goal_id, t.investment_date,
         t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'
              and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
         ), 0) as eff
    from public.investment_transactions t
   where t.deposit_group_id = p_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null
     and t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'
              and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
         ), 0) > 0;
$$;

-- How a book close is split across its live tranches: each takes its share of the
-- principal and of the cash, by running totals so the rounding cannot drift and
-- the parts always sum to the whole.
--
-- Extracted so the close can CHECK the split before writing it. The cash share is
-- rounded, and rounding a small payout across several tranches can land on zero
-- for one of them (a two-tranche book paid 1 đồng gives 1 and 0) — while its
-- principal share is still positive, so the row is written and refused by
-- amount_vnd > 0. That surfaced as a rolled-back finish behind a generic error,
-- for a plan the UI and the route had both accepted.
create or replace function public.book_payout_allocation(
  p_book_id uuid,
  p_withdraw_principal bigint,
  p_total_received bigint,
  p_total_principal bigint
)
returns table (transaction_id uuid, user_id uuid, goal_id uuid, principal_out bigint, cash_out bigint)
language sql
security invoker
stable
set search_path = ''
as $$
  with ranked as (
    select t.transaction_id, t.user_id, t.goal_id, t.eff,
           sum(t.eff) over (order by t.investment_date, t.transaction_id
                            rows between unbounded preceding and current row) as cum
      from public.book_live_tranches(p_book_id) t
  )
  select transaction_id, user_id, goal_id,
         (round(p_withdraw_principal::numeric * cum / p_total_principal)
           - round(p_withdraw_principal::numeric * (cum - eff) / p_total_principal))::bigint,
         (round(p_total_received::numeric * cum / p_total_principal)
           - round(p_total_received::numeric * (cum - eff) / p_total_principal))::bigint
    from ranked;
$$;

-- ── withdraw_accumulating_book, without the temp table ───────────────────────
--
-- Body unchanged from 20260618000009 except that `_book_live` is now a CTE.
-- `create temporary table … on commit drop` survives until COMMIT, so the second
-- call inside one transaction failed with "relation _book_live already exists" —
-- which is exactly what finishing a goal holding two accumulating books does.
create or replace function public.withdraw_accumulating_book(
  p_book_id uuid,
  p_withdraw_principal bigint,
  p_total_received bigint,
  p_investment_date date,
  p_affects_progress boolean
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_total_principal bigint;
  v_inserted integer;
begin
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_book_id
     and deposit_group_id = p_book_id
   for update;
  if not found then
    raise exception 'withdraw_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'withdraw_accumulating_book: not a bank book'
      using errcode = 'check_violation';
  end if;
  if p_total_received is null or p_total_received < 0 then
    raise exception 'withdraw_accumulating_book: total received must be non-negative'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'withdraw_accumulating_book: withdrawal date cannot be in the future'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(eff), 0) into v_total_principal
    from public.book_live_tranches(p_book_id);
  if v_total_principal <= 0 then
    raise exception 'withdraw_accumulating_book: nothing to withdraw'
      using errcode = 'check_violation';
  end if;
  if p_withdraw_principal is null or p_withdraw_principal <= 0 then
    raise exception 'withdraw_accumulating_book: withdraw amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_withdraw_principal > v_total_principal then
    raise exception 'withdraw_accumulating_book: cannot withdraw more than the book balance'
      using errcode = 'check_violation';
  end if;

  -- Refuse a split the ledger cannot record, rather than writing part of it and
  -- being refused by amount_vnd > 0 half way through (see book_payout_allocation).
  if exists (
    select 1 from public.book_payout_allocation(
      p_book_id, p_withdraw_principal, p_total_received, v_total_principal)
     where principal_out > 0 and cash_out <= 0
  ) then
    raise exception 'withdraw_accumulating_book: a payout of % is too small to record on every tranche of this book',
      p_total_received using errcode = 'check_violation';
  end if;

  with alloc as (
    select * from public.book_payout_allocation(
      p_book_id, p_withdraw_principal, p_total_received, v_total_principal)
  )
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress
  )
  select user_id, goal_id, 'bank', 'withdrawal', transaction_id,
         p_investment_date, cash_out, principal_out, p_affects_progress
    from alloc
   where principal_out > 0;

  get diagnostics v_inserted = row_count;

  -- Full close: the book is settled. Unlink any recurring that fed it, then clear
  -- the group so nothing can resurrect it (a recurring auto-top-up included).
  if p_withdraw_principal >= v_total_principal then
    update public.recurring_savings
       set linked_deposit_tx_id = null, updated_at = now()
     where user_id = v_anchor.user_id
       and linked_deposit_tx_id in (
         select transaction_id from public.investment_transactions
          where deposit_group_id = p_book_id
       );
    update public.investment_transactions
       set deposit_group_id = null, updated_at = now()
     where deposit_group_id = p_book_id;
  end if;

  return v_inserted;
end;
$$;

-- Everything about one ledger row that can change what a goal is worth, as one
-- comparable string.
--
-- ONE list, two readers: the fingerprint below hashes it, and the completed-goal
-- freeze compares it across an edit. Keeping them apart is what produced three
-- separate findings in a row — transaction_type, fund_id, asset_type — each a
-- column one guard listed and the other did not. A field added here is watched by
-- both from that moment on, and neither can be "forgotten" again.
--
-- Fund NAV and the gold price are deliberately NOT here. They move on their own
-- all day; a valuation is a point in time, and treating a market tick as a ledger
-- change would make the finish button unpressable and freeze nothing usefully.
create or replace function public.ledger_row_value_key(t public.investment_transactions)
returns text
language sql
immutable
set search_path = ''
as $$
  select t.transaction_id::text
    || '|' || t.transaction_type
    || '|' || coalesce(t.asset_type, '')
    || '|' || coalesce(t.goal_id::text, '')
    || '|' || coalesce(t.fund_id::text, '')
    || '|' || coalesce(t.parent_transaction_id::text, '')
    || '|' || coalesce(t.deposit_group_id::text, '')
    || '|' || coalesce(t.renewed_from_transaction_id::text, '')
    || '|' || t.amount_vnd::text
    || '|' || coalesce(t.units::text, '')
    || '|' || coalesce(t.unit_price::text, '')
    || '|' || coalesce(t.interest_rate::text, '')
    || '|' || t.investment_date::text
    || '|' || coalesce(t.expiry_date::text, '')
    || '|' || coalesce(t.principal_withdrawn::text, '')
    || '|' || coalesce(t.units_withdrawn::text, '')
    || '|' || coalesce(t.affects_progress::text, '')
    || '|' || coalesce(t.held_for_merge::text, '')
    || '|' || coalesce(t.consumed_by_inv_id::text, '')
    -- Only while the settlement is still PARKED. Once a merge has consumed it,
    -- the cash lives in the destination deposit, lib/heldForMerge skips the row,
    -- and the target is dead metadata — which deleting the goal has to clear
    -- before the delete can land (the reference has no FK, so it would otherwise
    -- dangle). Counting it here made that cleanup a "value change", the freeze
    -- refused it on a completed goal, and the goal could not be deleted at all.
    || '|' || case when t.consumed_by_inv_id is null
                   then coalesce(t.merge_target_goal_id::text, '') else '' end;
$$;

-- What the goal's ledger looks like right now, as one comparable value.
--
-- The completion snapshot is the goal's progress value, and computing that means
-- the whole dashboard valuation — which lives in TypeScript and is not going to be
-- rewritten in SQL for this (two copies of a valuation is exactly the drift #532
-- removed from the read endpoints). So the route computes it, and then has to
-- prove it is still true: a deposit or a withdrawal landing between the valuation
-- and the lock would archive a figure the ledger no longer supports.
--
-- Both sides read this same function, so the comparison is between two database
-- reads and never involves the application's clock.
create or replace function public.savings_goal_ledger_fingerprint(p_goal_id uuid)
returns text
language sql
security invoker
stable
set search_path = ''
as $$
  -- Hashed over the FIELDS THAT CARRY VALUE, not over count + updated_at.
  -- updated_at is an ordinary client-writable column: a PostgREST update can
  -- change amount_vnd or units without touching it, and the count is unchanged
  -- by any edit at all — so the two together would have called the ledger
  -- unmoved for exactly the writes this check exists to catch.
  --
  -- Fund NAV and the gold price are deliberately absent. They move on their own
  -- all day; a valuation is a point in time and refusing a finish because the
  -- market ticked would make the button unpressable. What must not change under
  -- the valuation is the LEDGER.
  select md5(coalesce(string_agg(public.ledger_row_value_key(t), ',' order by t.transaction_id), ''))
    from public.investment_transactions t
   where t.goal_id = p_goal_id
      -- ...and the withdrawals that draw on this goal WITHOUT carrying its id. A
      -- bank/gold withdrawal is keyed by its parent, not by a goal, and the sell
      -- sheet legitimately posts goal_id = NULL from the unallocated context. Such
      -- a row lowers exactly the holding this finish is about to liquidate — the
      -- RPC's parent_wd CTE counts it — so leaving it out of the fingerprint let
      -- the reduced remainder be liquidated against the pre-withdrawal value.
      --
      -- Fund sells are deliberately NOT pulled in the same way: they are keyed by
      -- (goal, fund), so one carrying goal_id = NULL draws on the Unallocated
      -- bucket and not on this goal at all. Same balance-key rules as the
      -- valuation and as check_withdrawal_balance.
      or (t.transaction_type = 'withdrawal'
          and not coalesce(t.asset_type = 'fund' and t.fund_id is not null, false)
          and t.parent_transaction_id in (
            select p.transaction_id from public.investment_transactions p
             where p.goal_id = p_goal_id));
$$;

comment on function public.savings_goal_ledger_fingerprint(uuid) is
  'A goal ledger''s current shape, for the finish''s optimistic check that its valuation is still true (#650).';

-- ── the finish itself ────────────────────────────────────────────────────────
--
-- p_plan is the realized cash per holding: [{"key": "...", "received": 123}, …],
-- keyed the way the holdings tab groups them —
--   'fund:<fund_id>'   one bucket per fund, per goal (a fund can be split
--                      across goals; only this goal's units are sold)
--   'book:<anchor_id>' an accumulating book, closed whole
--   'tx:<tx_id>'       a single deposit / gold / stock row
--
-- Only the CASH is the user's to state — an early withdrawal forfeits interest,
-- gold sells at the day's price. WHAT is liquidated is not: this is a full
-- liquidation, so every holding gives up its whole remaining principal and units,
-- computed here. A plan that misses a live holding, or names one the goal does not
-- hold, is refused rather than half-applied — it means the user is looking at a
-- stale page, and finishing off a stale page is how a holding survives the finish
-- and keeps a "completed" goal alive.
-- Every live holding of a goal, exactly as the finish will liquidate it.
--
-- Extracted from finish_savings_goal so the SHEET can build its plan from the
-- same enumeration the RPC validates it against. The goal-detail page loads the
-- newest 200 transactions; on a goal with more history than that, older holdings
-- fell off the page, the plan the sheet built was missing their keys, and the
-- finish was refused as incomplete — a long-lived goal simply could not be
-- finished. The client's view of what a goal holds is not authoritative, and
-- with this it no longer has to be.
create or replace function public.savings_goal_live_holdings(p_goal_id uuid)
returns table (
  key text, kind text, fund_id uuid, tx_id uuid, asset_type text,
  principal bigint, units numeric, name text
)
language sql
security invoker
stable
set search_path = ''
as $$
    with parent_wd as (
      select w.parent_transaction_id as pid,
             sum(coalesce(w.principal_withdrawn, 0)) as principal,
             sum(coalesce(w.units_withdrawn, 0)) as units
        from public.investment_transactions w
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and w.parent_transaction_id is not null
         -- A row keyed by a fund draws on that bucket, not on its parent — the
         -- same precedence check_withdrawal_balance applies.
         and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
       group by 1
    ),
    fund_wd as (
      select w.fund_id,
             sum(coalesce(w.principal_withdrawn, 0)) as principal,
             sum(coalesce(w.units_withdrawn, 0)) as units
        from public.investment_transactions w
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and w.asset_type = 'fund'
         and w.fund_id is not null
         and w.goal_id is not distinct from p_goal_id
       group by 1
    ),
    -- The bucket's OTHER kind of claim (#606). A withdrawal PARENTED to one of
    -- its purchases and not itself fund-keyed draws on the bucket too, at its
    -- recorded units or the capped pro-rata share of the purchase it names.
    -- Such rows can no longer be written, but the ones already in the ledger are
    -- still claims and check_withdrawal_balance measures every new sale against
    -- them — so a goal holding one could not be finished at all: this function
    -- computed the gross bucket and the table refused the oversized sale.
    -- Derivation copied from 20260803000005 so the two cannot disagree.
    fund_parent_wd as (
      select p.fund_id,
             sum(case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                      else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd)
                 end) as units,
             sum(coalesce(w.principal_withdrawn, 0)) as principal
        from public.investment_transactions w
        join public.investment_transactions p
          on p.transaction_id = w.parent_transaction_id
       where w.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and w.transaction_type = 'withdrawal'
         and (w.asset_type is distinct from 'fund' or w.fund_id is null)
         and p.transaction_type = 'investment'
         and p.asset_type = 'fund'
         and p.goal_id is not distinct from p_goal_id
         -- A purchase with no units is no bucket: its withdrawal sits on the
         -- parent axis and is measured there instead.
         and coalesce(p.units, 0) > 0
         and coalesce(p.amount_vnd, 0) > 0
       group by p.fund_id
    ),
    live as (
      select t.*,
             t.amount_vnd - coalesce(pw.principal, 0) as eff_principal,
             coalesce(t.units, 0) - coalesce(pw.units, 0) as eff_units
        from public.investment_transactions t
        left join parent_wd pw on pw.pid = t.transaction_id
       where t.user_id = (select g.user_id from public.savings_goals g where g.goal_id = p_goal_id)
         and t.goal_id = p_goal_id
         and t.transaction_type = 'investment'
         and t.renewed_from_transaction_id is null
         and not coalesce(t.held_for_merge, false)
    )
    select 'fund:' || l.fund_id as key, 'fund'::text as kind, l.fund_id,
           null::uuid as tx_id, 'fund'::text as asset_type,
           (sum(l.amount_vnd) - coalesce(max(fw.principal), 0) - coalesce(max(fpw.principal), 0))::bigint as principal,
           (sum(l.units) - coalesce(max(fw.units), 0) - coalesce(max(fpw.units), 0))::numeric as units
           , max(f.name) as name
      from live l
      left join public.funds f on f.id = l.fund_id
      left join fund_wd fw on fw.fund_id = l.fund_id
      left join fund_parent_wd fpw on fpw.fund_id = l.fund_id
     where l.fund_id is not null and l.asset_type = 'fund' and l.units is not null
     group by l.fund_id
    having sum(l.units) - coalesce(max(fw.units), 0) - coalesce(max(fpw.units), 0) > 0
    union all
    select 'book:' || l.deposit_group_id, 'book', null, l.deposit_group_id, 'bank',
           sum(l.eff_principal)::bigint, null::numeric,
           max(case when l.transaction_id = l.deposit_group_id then l.notes end)
      from live l
     where l.fund_id is null and l.deposit_group_id is not null
       and l.eff_principal > 0
     group by l.deposit_group_id
    union all
    select 'tx:' || l.transaction_id, 'single', null, l.transaction_id, l.asset_type,
           l.eff_principal::bigint,
           case when l.asset_type = 'gold' then l.eff_units::numeric else null end,
           l.notes
      from live l
     where l.fund_id is null and l.deposit_group_id is null
       and (case when l.asset_type = 'gold' then l.eff_units > 0 else l.eff_principal > 0 end)
$$;

comment on function public.savings_goal_live_holdings(uuid) is
  'The holdings a finish would liquidate, by the same balance keys the ledger uses (#650). One enumeration for the sheet and the RPC.';

-- Both earlier shapes are dropped first. The four-argument one would otherwise
-- make a four-argument call ambiguous rather than overloaded ("function is not
-- unique"), and Postgres refuses to remove a parameter default through CREATE OR
-- REPLACE — the fingerprint was optional for one revision and is now required.
-- Only ever created by this migration.
drop function if exists public.finish_savings_goal(uuid, jsonb, date, bigint);
drop function if exists public.finish_savings_goal(uuid, jsonb, date, bigint, text);

create or replace function public.finish_savings_goal(
  p_goal_id uuid,
  p_plan jsonb,
  p_date date,
  p_completion_value bigint,
  -- The ledger the completion value was computed against
  -- (savings_goal_ledger_fingerprint, read before the valuation). Required.
  p_ledger_fingerprint text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_goal public.savings_goals;
  v_blocker record;
  v_h record;
  v_received bigint;
  v_realized bigint := 0;
  v_holdings int := 0;
  v_plan_keys text[];
  v_live_keys text[] := '{}';
  v_extra text[];
begin
  select * into v_goal from public.savings_goals where goal_id = p_goal_id for update;
  if not found then
    raise exception 'finish goal: goal not found' using errcode = 'no_data_found';
  end if;
  if v_goal.completed_at is not null then
    raise exception 'finish goal: this goal is already completed'
      using errcode = 'check_violation';
  end if;
  if p_date is null or p_date > current_date + 1 then
    raise exception 'finish goal: the finish date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_completion_value is null or p_completion_value < 0 then
    raise exception 'finish goal: completion value must be non-negative'
      using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'array' then
    raise exception 'finish goal: the liquidation plan must be an array'
      using errcode = 'check_violation';
  end if;

  -- Lock the goal's ledger BEFORE reading the fingerprint, or the comparison
  -- proves nothing about what happens next.
  --
  -- The goal's own FOR UPDATE does not cover a withdrawal written against one of
  -- its holdings with goal_id = NULL: that insert touches the parent row and the
  -- goal row never, so it could commit between the comparison and the
  -- holdings query, and the finish would liquidate the reduced remainder while
  -- archiving the pre-withdrawal value. Holding these rows closes it, because
  -- check_withdrawal_balance locks the source it measures — a bank/gold
  -- withdrawal locks its parent, a fund sell locks the bucket's purchases — and
  -- both are in here. Same order (transaction_id) as that function takes them in,
  -- so the two cannot deadlock.
  perform 1 from public.investment_transactions t
   where t.user_id = v_goal.user_id
     and t.goal_id = p_goal_id
   order by t.transaction_id
     for update;

  -- The plan check further down catches a changed SET of holdings; this catches a
  -- changed AMOUNT, which leaves the keys identical and would otherwise archive a
  -- snapshot the ledger no longer supports.
  --
  -- Required, not optional: a caller reaching this function directly could
  -- otherwise skip the staleness check by passing NULL.
  if p_ledger_fingerprint is null then
    raise exception 'finish goal: the ledger fingerprint the valuation was taken against is required'
      using errcode = 'check_violation';
  end if;
  if p_ledger_fingerprint is distinct from public.savings_goal_ledger_fingerprint(p_goal_id) then
    raise exception 'finish goal: this goal changed while it was being valued — reload it and try again'
      using errcode = 'check_violation';
  end if;

  -- A holding dated after the finish itself, measured against THIS date rather
  -- than against today: the blocker list uses current_date, and a caller may pass
  -- an earlier p_date. Liquidating one would write a withdrawal before the
  -- purchase it draws on and settle a contribution that has not happened.
  if exists (
    select 1 from public.investment_transactions t
     where t.user_id = v_goal.user_id
       and t.goal_id = p_goal_id
       and t.transaction_type = 'investment'
       and t.renewed_from_transaction_id is null
       and t.investment_date > p_date
  ) then
    raise exception 'future holding: this goal holds a contribution dated after the finish, so it cannot be liquidated yet'
      using errcode = 'check_violation';
  end if;

  -- Re-checked under the goal's lock, not merely on the way into the sheet: the
  -- user may have created a recurring saving in another tab since.
  select * into v_blocker from public.savings_goal_finish_blockers(p_goal_id) limit 1;
  if found then
    raise exception 'finish goal blocked: % %', v_blocker.code, v_blocker.label
      using errcode = 'check_violation';
  end if;

  select coalesce(array_agg(e->>'key'), '{}') into v_plan_keys
    from jsonb_array_elements(p_plan) e;
  if exists (
    select 1 from unnest(v_plan_keys) k group by k having count(*) > 1
  ) then
    raise exception 'finish goal: the liquidation plan names a holding twice'
      using errcode = 'check_violation';
  end if;

  -- Every live holding of this goal, valued at what it still holds. Mirrors
  -- buildInvRows: funds dedup per fund, tranches roll up into their book, and a
  -- holding drawn down to nothing is not a holding.
  for v_h in select * from public.savings_goal_live_holdings(p_goal_id)
  loop
    v_live_keys := v_live_keys || v_h.key;
    select (e->>'received')::bigint into v_received
      from jsonb_array_elements(p_plan) e
     where e->>'key' = v_h.key;
    if v_received is null then
      raise exception 'finish goal: the liquidation plan leaves holding % unrealized', v_h.key
        using errcode = 'check_violation';
    end if;
    -- Zero is refused, not silently accepted: investment_transactions requires
    -- amount_vnd > 0, so a zero-cash liquidation would be rejected by the table
    -- three statements later and the whole finish would roll back behind a
    -- generic error. A holding that truly paid out nothing has no withdrawal
    -- shape in this ledger — write it off by deleting the holding instead.
    if v_received <= 0 then
      raise exception 'finish goal: holding % must realize a positive amount', v_h.key
        using errcode = 'check_violation';
    end if;

    -- affects_progress = TRUE, and the reasoning is worth stating: these
    -- withdrawals are ordinary, and the SNAPSHOT owns the percentage.
    --
    -- affects_progress = false exists for a partial spend on a goal that is still
    -- running — it holds the bar steady while net worth falls. A finish is not
    -- that: completion is declared, and every surface reads the archived 100%
    -- from completed_at / completion_percentage rather than recomputing it.
    --
    -- Written false, they would go on propping the bar up after the goal is
    -- REOPENED — the snapshot is cleared, the balance is zero, and the goal would
    -- come back reading its pre-finish progress with new contributions stacking
    -- on top of a value that no longer exists. Reopening a goal has to show it as
    -- the (probably empty) goal it now is.
    if v_h.kind = 'book' then
      -- A book is closed as a WHOLE: withdraw_accumulating_book spreads the
      -- amount across every live tranche it has. This function only counted the
      -- tranches belonging to THIS goal, so on a book shared between two goals
      -- it handed over one goal's share and had it spread across both — taking
      -- money out of the other goal's tranche, leaving part of this goal's own
      -- balance live, and archiving at 100% regardless.
      --
      -- The app moves a book between goals as one group, but a direct write can
      -- split it and nothing refuses that today. Refusing here is the honest
      -- answer: closing half a book is not a shape the dissolve logic has, and
      -- silently taking the other goal's money is not one either.
      if exists (
        select 1 from public.book_live_tranches(v_h.tx_id) t
         where t.goal_id is distinct from p_goal_id
      ) then
        raise exception 'split book: % has tranches in another goal, so it cannot be closed by finishing this one — move the whole book into one goal first',
          coalesce(v_h.name, 'this book') using errcode = 'check_violation';
      end if;
      perform public.withdraw_accumulating_book(
        v_h.tx_id, v_h.principal, v_received, p_date, true);
    elsif v_h.kind = 'fund' then
      insert into public.investment_transactions (
        user_id, goal_id, fund_id, asset_type, transaction_type, investment_date,
        amount_vnd, principal_withdrawn, units_withdrawn, affects_progress
      ) values (
        v_goal.user_id, p_goal_id, v_h.fund_id, 'fund', 'withdrawal', p_date,
        v_received, v_h.principal, v_h.units, true
      );
    else
      insert into public.investment_transactions (
        user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
        investment_date, amount_vnd, principal_withdrawn, units_withdrawn, affects_progress
      ) values (
        v_goal.user_id, p_goal_id, v_h.asset_type, 'withdrawal', v_h.tx_id,
        p_date, v_received, v_h.principal, v_h.units, true
      );
    end if;

    v_realized := v_realized + v_received;
    v_holdings := v_holdings + 1;
  end loop;

  -- A key the goal does not hold means the page the plan came from is not the
  -- goal as it stands. Refuse rather than finish on a guess.
  select coalesce(array_agg(k), '{}') into v_extra
    from unnest(v_plan_keys) k where not (k = any (v_live_keys));
  if array_length(v_extra, 1) > 0 then
    raise exception 'finish goal: the liquidation plan names holdings this goal does not hold (%)',
      array_to_string(v_extra, ', ') using errcode = 'check_violation';
  end if;

  -- Transaction-local, so it is gone the moment this statement's transaction
  -- ends and cannot leak the privilege to anything else the session does.
  perform set_config('app.goal_completion_write', '1', true);
  update public.savings_goals
     set completed_at = now(),
         completion_value = p_completion_value,
         completion_percentage = 100,
         updated_at = now()
   where goal_id = p_goal_id;
  perform set_config('app.goal_completion_write', '', true);

  return jsonb_build_object(
    'realized', v_realized,
    'holdings', v_holdings,
    'completion_value', p_completion_value,
    'completion_percentage', 100
  );
end;
$$;

comment on function public.finish_savings_goal(uuid, jsonb, date, bigint, text) is
  'Liquidates every live holding of a goal and archives it at 100%, atomically (#650). All-or-nothing: any refused withdrawal rolls back the whole finish.';

-- ── an archive takes no new money ────────────────────────────────────────────
--
-- Keeping completed goals out of the pickers is presentation, and presentation is
-- not an invariant: a tab left open before the finish, a retried request, or any
-- direct API client can still point a new holding — or a recurring saving, or a
-- DCA plan — at a goal that has been archived. The holding then sits under a
-- frozen 100% and is invisible on the card, which is the exact "money hiding
-- behind a number" this feature exists to prevent.
--
-- So it is a table invariant, for the same reason the withdrawal balance is one
-- (20260730000002): the goal reference has many writers already, and the next one
-- is written by whoever forgets.
--
-- Only a CHANGE to the reference is measured, so an ordinary edit to a row that
-- already belongs to the goal is unaffected. What that row is allowed to change
-- is the next trigger's business.
create or replace function public.enforce_goal_not_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col text := tg_argv[0];
  v_new uuid;
  v_old uuid;
  v_completed timestamptz;
begin
  execute format('select ($1).%I', v_col) into v_new using new;
  if v_new is null then return new; end if;
  if tg_op = 'UPDATE' then
    execute format('select ($1).%I', v_col) into v_old using old;
    if v_old is not distinct from v_new then return new; end if;
  end if;
  -- FOR SHARE, not a plain read. finish_savings_goal holds FOR UPDATE on the
  -- goal for the whole liquidation, and a plain EXISTS does not participate in
  -- that lock: the trigger would read the goal as still active on its own
  -- snapshot, the row's FOREIGN KEY check (which runs AFTER this trigger) would
  -- then wait for the finish to commit, and the insert would land under a goal
  -- that is completed by the time it does — money surviving the archive, which
  -- is precisely what this trigger exists to stop.
  --
  -- FOR SHARE conflicts with that FOR UPDATE, so the write waits here instead,
  -- and the row it reads once the lock is granted is the post-finish version.
  select g.completed_at into v_completed
    from public.savings_goals g
   where g.goal_id = v_new
     for share;
  if v_completed is not null then
    raise exception 'completed goal: this goal has been finished, so it takes no new money — reopen it first'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- A completed goal's LEDGER is frozen too, not only its future.
--
-- Without this, deleting one of the liquidation withdrawals from the transaction
-- ledger brings the original holding back to life — worth its full principal
-- again — under a goal still archived at 100%. An accumulating book comes back
-- worse: its close cleared deposit_group_id, so the tranches reappear as separate
-- loose deposits. Raising an original investment's amount does the same without
-- ever touching goal_id, so the reference trigger above cannot see it.
--
-- Frozen means the MONEY. Renaming a deposit, correcting its notes or its bank —
-- anything that does not change what the goal holds — stays editable, because a
-- completed goal is still history the user reads and tidies. Changing the money
-- means reopening the goal first, which is one click and states the intent.
-- Which goals a ledger row's money belongs to — by the same balance keys the
-- valuation and check_withdrawal_balance use, not by goal_id alone.
--
-- A bank/gold withdrawal draws on its PARENT, and carries whatever goal_id the
-- sheet that wrote it happened to set: the sell sheet posts NULL from the
-- unallocated context, which is legitimate and common. Such a row belongs to the
-- parent's goal however it is labelled. A fund sell is the opposite — it is keyed
-- by (goal, fund) and draws on that bucket, so its own goal_id IS the answer and
-- its parent, if any, is not consulted.
create or replace function public.ledger_row_goals(t public.investment_transactions)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    t.goal_id,
    case
      when t.transaction_type = 'withdrawal'
       and not coalesce(t.asset_type = 'fund' and t.fund_id is not null, false)
       and t.parent_transaction_id is not null
      then (select p.goal_id from public.investment_transactions p
             where p.transaction_id = t.parent_transaction_id)
    end
  ], null);
$$;

-- SECURITY DEFINER and therefore an oracle if left open: called with a hand-built
-- row it reports which goal a stranger's transaction belongs to, RLS bypassed.
-- The trigger calls it as the definer and needs no grant (same reasoning as
-- check_withdrawal_balance, 20260730000002).
revoke all on function public.ledger_row_goals(public.investment_transactions) from public;
revoke all on function public.ledger_row_goals(public.investment_transactions) from anon, authenticated;

create or replace function public.enforce_completed_goal_ledger_frozen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goals uuid[];
  v_goal uuid;
  v_completed timestamptz;
begin
  -- One question, asked of the shared value key rather than of a hand-kept column
  -- list: did anything change that alters what this row is worth to a goal?
  -- Enumerating the columns here is what let transaction_type, fund_id and
  -- asset_type through in turn — each is identity, not decoration. Flipping a
  -- finish-created withdrawal to an investment stops it offsetting its parent and
  -- makes it a holding of its own; re-pointing a settled purchase at another fund
  -- leaves the sell in the old bucket. Neither changes an amount.
  if tg_op = 'UPDATE'
     and public.ledger_row_value_key(old) = public.ledger_row_value_key(new) then
    return new;
  end if;

  -- BOTH ends of the change, and for each end every goal the row's money touches.
  --
  -- The OLD end, because moving a settled row OUT of a completed goal is the same
  -- escape as changing its money in place — and the reference guard cannot see
  -- that one: it measures where a row is GOING, and going to NULL or to another
  -- active goal is exactly what it lets through. The sharpest case is a fund,
  -- whose bucket is keyed by (goal, fund): unassigning a finished goal's purchase
  -- moves it to Unallocated while the sell that emptied it stays with the
  -- archive, so the whole position reappears with nothing offsetting it.
  --
  -- And by BALANCE KEY rather than by goal_id, because a bank/gold withdrawal
  -- belongs to its parent's goal whatever its own label says. A pre-finish
  -- partial withdrawal written from the unallocated context carries goal_id =
  -- NULL; deleting it after the finish gives the deposit back the principal that
  -- withdrawal had taken — the finish only closed the balance that was left —
  -- and it stands as a live holding under an archived goal.
  --
  -- Deleting the GOAL is not any of this: by the time ON DELETE SET NULL fires,
  -- the goal row is gone and the lookups below find nothing, so an archived goal
  -- can still be deleted outright.
  if tg_op = 'DELETE' then
    v_goals := public.ledger_row_goals(old);
  else
    v_goals := public.ledger_row_goals(old) || public.ledger_row_goals(new);
  end if;

  foreach v_goal in array coalesce(v_goals, '{}'::uuid[]) loop
    select g.completed_at into v_completed
      from public.savings_goals g
     where g.goal_id = v_goal
       for share;
    if v_completed is not null then
      raise exception 'completed goal: this goal has been finished, so its transactions are settled — reopen it to change them'
        using errcode = 'check_violation';
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

comment on function public.enforce_completed_goal_ledger_frozen() is
  'Refuses to delete, or to change the money on, a transaction belonging to a finished goal — that would resurrect holdings under a frozen 100% (#650).';

drop trigger if exists investment_transactions_completed_goal_frozen on public.investment_transactions;
create trigger investment_transactions_completed_goal_frozen
  -- No column list. A list is a promise to remember, and this guard has already
  -- been escaped three times by a column nobody thought of; the function asks the
  -- shared value key instead and returns immediately when nothing moved.
  before delete or update on public.investment_transactions
  for each row execute function public.enforce_completed_goal_ledger_frozen();

comment on function public.enforce_goal_not_completed() is
  'Refuses to point a new holding, recurring saving or DCA plan at an archived goal (#650). The reference column is tg_argv[0].';

-- The finish itself is safe under these: it writes every withdrawal BEFORE it
-- stamps the snapshot, so the goal is still active while they land.
drop trigger if exists investment_transactions_goal_not_completed on public.investment_transactions;
create trigger investment_transactions_goal_not_completed
  before insert or update of goal_id on public.investment_transactions
  for each row execute function public.enforce_goal_not_completed('goal_id');

drop trigger if exists investment_transactions_merge_goal_not_completed on public.investment_transactions;
create trigger investment_transactions_merge_goal_not_completed
  before insert or update of merge_target_goal_id on public.investment_transactions
  for each row execute function public.enforce_goal_not_completed('merge_target_goal_id');

drop trigger if exists recurring_savings_goal_not_completed on public.recurring_savings;
create trigger recurring_savings_goal_not_completed
  before insert or update of goal_id on public.recurring_savings
  for each row execute function public.enforce_goal_not_completed('goal_id');

drop trigger if exists funds_dca_goal_not_completed on public.funds;
create trigger funds_dca_goal_not_completed
  before insert or update of dca_goal_id on public.funds
  for each row execute function public.enforce_goal_not_completed('dca_goal_id');

-- ── reopening ────────────────────────────────────────────────────────────────
--
-- Correcting an archive, not undoing a liquidation. The withdrawals stay: the
-- money really did leave, and re-creating the holdings would invent transactions
-- the bank never made. Clearing the snapshot is enough to put the goal back on the
-- active lists, where it reads as the (probably empty) goal it now is.
create or replace function public.reopen_savings_goal(p_goal_id uuid)
returns public.savings_goals
language plpgsql
security invoker
set search_path = ''
as $$
declare v_goal public.savings_goals;
begin
  perform set_config('app.goal_completion_write', '1', true);
  update public.savings_goals
     set completed_at = null,
         completion_value = null,
         completion_percentage = null,
         updated_at = now()
   where goal_id = p_goal_id
     and completed_at is not null
  returning * into v_goal;
  -- Checked BEFORE the flag is cleared: a successful PERFORM sets FOUND, so
  -- clearing first would report every reopen as having found a goal.
  if not found then
    raise exception 'reopen goal: no completed goal to reopen'
      using errcode = 'no_data_found';
  end if;
  perform set_config('app.goal_completion_write', '', true);
  return v_goal;
end;
$$;

comment on function public.reopen_savings_goal(uuid) is
  'Clears a goal''s completion snapshot so it returns to the active lists. Historical transactions are untouched (#650).';
