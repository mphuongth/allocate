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
  -- A recurring saving that has already ended is history and feeds nothing.
  select 'recurring_saving'::text, r.name
    from public.recurring_savings r
   where r.goal_id = p_goal_id
     and (r.effective_to is null or r.effective_to >= current_date)
  union all
  select 'dca_plan'::text, f.name
    from public.funds f
   where f.dca_goal_id = p_goal_id
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
         ), 0) as eff
    from public.investment_transactions t
   where t.deposit_group_id = p_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null
     and t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'
         ), 0) > 0;
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

  with live as (
    select * from public.book_live_tranches(p_book_id)
  ),
  ranked as (
    select transaction_id, user_id, goal_id, eff,
           sum(eff) over (order by investment_date, transaction_id
                          rows between unbounded preceding and current row) as cum
      from live
  ),
  alloc as (
    select transaction_id, user_id, goal_id,
           round(p_withdraw_principal::numeric * cum / v_total_principal)
             - round(p_withdraw_principal::numeric * (cum - eff) / v_total_principal) as principal_out,
           round(p_total_received::numeric * cum / v_total_principal)
             - round(p_total_received::numeric * (cum - eff) / v_total_principal) as cash_out
      from ranked
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
create or replace function public.finish_savings_goal(
  p_goal_id uuid,
  p_plan jsonb,
  p_date date,
  p_completion_value bigint
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
  for v_h in
    with parent_wd as (
      select w.parent_transaction_id as pid,
             sum(coalesce(w.principal_withdrawn, 0)) as principal,
             sum(coalesce(w.units_withdrawn, 0)) as units
        from public.investment_transactions w
       where w.user_id = v_goal.user_id
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
       where w.user_id = v_goal.user_id
         and w.transaction_type = 'withdrawal'
         and w.asset_type = 'fund'
         and w.fund_id is not null
         and w.goal_id is not distinct from p_goal_id
       group by 1
    ),
    live as (
      select t.*,
             t.amount_vnd - coalesce(pw.principal, 0) as eff_principal,
             coalesce(t.units, 0) - coalesce(pw.units, 0) as eff_units
        from public.investment_transactions t
        left join parent_wd pw on pw.pid = t.transaction_id
       where t.user_id = v_goal.user_id
         and t.goal_id = p_goal_id
         and t.transaction_type = 'investment'
         and t.renewed_from_transaction_id is null
         and not coalesce(t.held_for_merge, false)
    )
    select 'fund:' || l.fund_id as key, 'fund'::text as kind, l.fund_id,
           null::uuid as tx_id, null::text as asset_type,
           (sum(l.amount_vnd) - coalesce(max(fw.principal), 0))::bigint as principal,
           (sum(l.units) - coalesce(max(fw.units), 0))::numeric as units
      from live l
      left join fund_wd fw on fw.fund_id = l.fund_id
     where l.fund_id is not null and l.asset_type = 'fund' and l.units is not null
     group by l.fund_id
    having sum(l.units) - coalesce(max(fw.units), 0) > 0
    union all
    select 'book:' || l.deposit_group_id, 'book', null, l.deposit_group_id, 'bank',
           sum(l.eff_principal)::bigint, null::numeric
      from live l
     where l.fund_id is null and l.deposit_group_id is not null
       and l.eff_principal > 0
     group by l.deposit_group_id
    union all
    select 'tx:' || l.transaction_id, 'single', null, l.transaction_id, l.asset_type,
           l.eff_principal::bigint,
           case when l.asset_type = 'gold' then l.eff_units::numeric else null end
      from live l
     where l.fund_id is null and l.deposit_group_id is null
       and (case when l.asset_type = 'gold' then l.eff_units > 0 else l.eff_principal > 0 end)
  loop
    v_live_keys := v_live_keys || v_h.key;
    select (e->>'received')::bigint into v_received
      from jsonb_array_elements(p_plan) e
     where e->>'key' = v_h.key;
    if v_received is null then
      raise exception 'finish goal: the liquidation plan leaves holding % unrealized', v_h.key
        using errcode = 'check_violation';
    end if;
    if v_received < 0 then
      raise exception 'finish goal: holding % cannot realize a negative amount', v_h.key
        using errcode = 'check_violation';
    end if;

    if v_h.kind = 'book' then
      perform public.withdraw_accumulating_book(
        v_h.tx_id, v_h.principal, v_received, p_date, false);
    elsif v_h.kind = 'fund' then
      insert into public.investment_transactions (
        user_id, goal_id, fund_id, asset_type, transaction_type, investment_date,
        amount_vnd, principal_withdrawn, units_withdrawn, affects_progress
      ) values (
        v_goal.user_id, p_goal_id, v_h.fund_id, 'fund', 'withdrawal', p_date,
        v_received, v_h.principal, v_h.units, false
      );
    else
      insert into public.investment_transactions (
        user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
        investment_date, amount_vnd, principal_withdrawn, units_withdrawn, affects_progress
      ) values (
        v_goal.user_id, p_goal_id, v_h.asset_type, 'withdrawal', v_h.tx_id,
        p_date, v_received, v_h.principal, v_h.units, false
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

  update public.savings_goals
     set completed_at = now(),
         completion_value = p_completion_value,
         completion_percentage = 100,
         updated_at = now()
   where goal_id = p_goal_id;

  return jsonb_build_object(
    'realized', v_realized,
    'holdings', v_holdings,
    'completion_value', p_completion_value,
    'completion_percentage', 100
  );
end;
$$;

comment on function public.finish_savings_goal(uuid, jsonb, date, bigint) is
  'Liquidates every live holding of a goal and archives it at 100%, atomically (#650). All-or-nothing: any refused withdrawal rolls back the whole finish.';

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
  update public.savings_goals
     set completed_at = null,
         completion_value = null,
         completion_percentage = null,
         updated_at = now()
   where goal_id = p_goal_id
     and completed_at is not null
  returning * into v_goal;
  if not found then
    raise exception 'reopen goal: no completed goal to reopen'
      using errcode = 'no_data_found';
  end if;
  return v_goal;
end;
$$;

comment on function public.reopen_savings_goal(uuid) is
  'Clears a goal''s completion snapshot so it returns to the active lists. Historical transactions are untouched (#650).';
