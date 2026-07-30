-- A withdrawal may never take more than its holding still holds (#587).
--
-- The sell/withdraw sheets capped the amount client-side (computeSellPreview's
-- sellOverMax / isOverUnits); POST /api/v1/investment-transactions validated the
-- numeric shape and inserted whatever it was given. So a stale tab, a retried
-- request, or two sells racing each other could each pass their own read of the
-- balance and both land: the holding goes past zero, the dashboard drops it
-- (valueNonFundHolding returns null at effectiveAmount <= 0) while the excess
-- withdrawal stays in history, and net worth and P&L are wrong from then on.
--
-- Why a trigger and not a service or an RPC the route calls: the balance has
-- several writers already — this route, renew_term_deposit_with_merge,
-- withdraw_accumulating_book, record_recurring_book_topup — and the next one is
-- written by whoever forgets. An invariant on the table holds for all of them,
-- including service-role and SQL writes, which is the same reasoning that moved
-- the recurring-link cleanup into the database in #531.
--
-- Why it is atomic: the check LOCKS THE SOURCE ROWS FIRST, then reads the sums in
-- a following statement. Under READ COMMITTED a competing insert holds that lock
-- until it commits, and the statement that reads the sums afterwards takes a new
-- snapshot — so the second withdrawal sees the first one and is measured against
-- the balance it left behind. Reading the sums first would let both pass.
--
-- Two balances, mirroring the two buckets the dashboard aggregates:
--   • bank / gold / stock — one source row, addressed by parent_transaction_id:
--     remaining principal = amount_vnd − Σ principal_withdrawn, remaining units =
--     units − Σ units_withdrawn (lib/depositValuation values it exactly so).
--   • fund — a sell has no parent row; the overview aggregates funds per
--     (goal_id, fund_id), so that bucket is the balance a sell draws down.
--
-- Not covered here, deliberately: lowering a *source's* amount_vnd below what has
-- already been withdrawn (an edit, not a withdrawal) is the mirror hole and wants
-- its own guard — collapse and renewal both rewrite amounts mid-transaction, so
-- checking them needs care this change doesn't have room for.
create or replace function public.enforce_withdrawal_within_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Clients round units_withdrawn to 4 decimals (parseFloat(u.toFixed(4))), so a
  -- FULL sell can post a hair more than the holding: 50.12345 units becomes
  -- 50.1235. Allow exactly that much and no more, or "sell everything" breaks.
  c_units_epsilon constant numeric := 0.0001;
  v_principal     bigint;
  v_units         numeric;
  v_out_principal bigint;
  v_out_units     numeric;
  v_left          bigint;
  v_left_units    numeric;
  v_parent_type   text;
  v_parent_asset  text;
begin
  if new.transaction_type is distinct from 'withdrawal' then return new; end if;

  -- A negative withdrawal runs the ledger backwards: it ADDS to the holding and
  -- banks a credit the next withdrawal can spend (the sums below are signed, and
  -- so is lib/depositValuation's subtraction). Nothing in the schema stops one, so
  -- the invariant does — before anything is measured, since a negative amount
  -- would poison the measurement itself.
  if coalesce(new.principal_withdrawn, 0) < 0 or coalesce(new.units_withdrawn, 0) < 0 then
    raise exception 'withdrawal amounts cannot be negative (principal %, units %)',
      new.principal_withdrawn, new.units_withdrawn using errcode = 'check_violation';
  end if;

  -- Deleting a source is an ordinary ledger action, and parent_transaction_id is
  -- ON DELETE SET NULL — so Postgres orphans the children with an UPDATE that
  -- lands right here. Measuring that update would refuse it (the row has just
  -- lost the holding it drew on) and turn a plain delete into an error.
  --
  -- Only THAT may orphan a row. Detaching a withdrawal from a source that is
  -- still there restores the holding to full value while the withdrawal is filed
  -- under no key at all — the same escape the rest of this function exists to
  -- close. The tell is the source itself: by the time the FK action fires, the
  -- parent row is already deleted and invisible to this query.
  -- Both links a withdrawal hangs on are ON DELETE SET NULL, so both deletions
  -- arrive here the same way: the deposit (parent_transaction_id) and the fund
  -- (fund_id, which a sell is keyed by).
  if tg_op = 'UPDATE' then
    if old.parent_transaction_id is not null and new.parent_transaction_id is null then
      if exists (select 1 from public.investment_transactions t
                  where t.transaction_id = old.parent_transaction_id) then
        raise exception 'withdrawal cannot be detached from holding %, which still exists',
          old.parent_transaction_id using errcode = 'check_violation';
      end if;
      -- The source is gone. The leftover orphan is a shape this invariant would
      -- not let anyone CREATE; cleaning those up as the source goes is issue #607.
      return new;
    end if;

    if old.fund_id is not null and new.fund_id is null then
      if exists (select 1 from public.funds f where f.id = old.fund_id) then
        raise exception 'withdrawal cannot be detached from fund %, which still exists',
          old.fund_id using errcode = 'check_violation';
      end if;
      return new;   -- the fund was deleted; same story as above
    end if;
  end if;

  -- The branch order is not a preference: it MIRRORS lib/withdrawalProgress, which
  -- keys any row with asset_type='fund' + fund_id by (goal, fund) and ignores its
  -- parent. Measuring such a row against a parent instead would check a balance
  -- nothing draws down — a fat holding in one goal waving through a phantom fund
  -- sell in another, since the API accepts both fields on one row.
  if new.asset_type = 'fund' and new.fund_id is not null then
    -- Both sides of the bucket carry `asset_type = 'fund'`, because that is what
    -- the valuation counts: a row whose asset_type was edited off 'fund' keeps its
    -- fund_id (the PUT clears fund_id only when that field is sent) but is valued
    -- as a bank holding, so its units are no longer fund inventory to sell.
    --
    -- Lock the bucket's investment rows before measuring them (see the header):
    -- this is what makes two concurrent sells of the same bucket serialize. Pending
    -- DCA seeds (units is null) are excluded: they carry a planned amount with no
    -- units bought yet, the dashboard never values them, so they hold nothing to
    -- sell. Renewal snapshots are history copies, not holdings.
    perform 1
      from public.investment_transactions t
     where t.user_id = new.user_id
       and t.fund_id = new.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from new.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null
     order by t.transaction_id      -- a stable lock order; concurrent sells can't deadlock
       for update;

    select coalesce(sum(t.amount_vnd), 0), coalesce(sum(t.units), 0)
      into v_principal, v_units
      from public.investment_transactions t
     where t.user_id = new.user_id
       and t.fund_id = new.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from new.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.user_id = new.user_id
       and w.fund_id = new.fund_id
       and w.asset_type = 'fund'
       and w.transaction_type = 'withdrawal'
       and w.goal_id is not distinct from new.goal_id
       and w.transaction_id <> new.transaction_id;

  elsif new.parent_transaction_id is not null then
    -- Bank / gold / stock: one source row. Lock it before measuring it, so two
    -- concurrent withdrawals of the same deposit serialize here.
    select t.amount_vnd, t.units, t.transaction_type, t.asset_type
      into v_principal, v_units, v_parent_type, v_parent_asset
      from public.investment_transactions t
     where t.transaction_id = new.parent_transaction_id
       and t.user_id = new.user_id
       for update;
    -- A parent that isn't the writer's own is the ownership trigger's refusal to
    -- make (#474 / #525); staying quiet here keeps that message the one the user
    -- sees instead of a confusing "no balance".
    if not found then return new; end if;

    -- A withdrawal is not a holding, so parenting to one invents a balance out of
    -- money that already left. Renewal snapshots ARE valid parents on purpose:
    -- renew and collapse re-parent partial withdrawals onto them, which is how a
    -- renewed deposit stops double-counting them (#585).
    --
    -- A parent that is a FUND purchase is left alone here, though review flagged
    -- it: such a row is ignored by buildWithdrawalMaps (the fund is valued through
    -- the goal/fund map, which never consults parentWdMap), so it is an UNCOUNTED
    -- withdrawal rather than an overdraw — a valuation gap that predates this
    -- change, and one supabase/tests/dca_seeding_heal.test.sql treats as data that
    -- exists. Bounding it by the parent's own principal, as below, is the most
    -- this invariant can honestly say about it.
    if v_parent_type is distinct from 'investment' then
      raise exception 'withdrawal draws on no holding: its parent % is not an investment',
        new.parent_transaction_id using errcode = 'check_violation';
    end if;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.parent_transaction_id = new.parent_transaction_id
       and w.transaction_type = 'withdrawal'
       and w.transaction_id <> new.transaction_id;   -- an UPDATE re-measures without itself

  else
    -- Nothing identifiable to draw down. A row taking principal or units out of no
    -- holding at all is not a withdrawal — buildWithdrawalMaps files it under
    -- neither key, so it subtracts from nothing while the record claims cash left.
    -- Reachable by editing a fund sell's asset_type off 'fund' (the fund_id stays,
    -- but the row leaves the fund bucket), which is why asset_type fires this
    -- trigger: running is not enough, the new shape has to be refused.
    if coalesce(new.principal_withdrawn, 0) > 0 or coalesce(new.units_withdrawn, 0) > 0 then
      raise exception 'withdrawal draws on no holding: it has neither a parent transaction nor a fund'
        using errcode = 'check_violation';
    end if;
    -- Carrying neither is a settlement row with nothing to measure — a
    -- held-for-merge with no source is exactly that shape, and giving it one is
    -- #588's job.
    return new;
  end if;

  if coalesce(new.principal_withdrawn, 0) > 0 then
    v_left := coalesce(v_principal, 0) - v_out_principal;
    if new.principal_withdrawn > v_left then
      raise exception 'withdrawal of % exceeds the remaining balance of % on this holding',
        new.principal_withdrawn, v_left using errcode = 'check_violation';
    end if;
  end if;

  if coalesce(new.units_withdrawn, 0) > 0 then
    v_left_units := coalesce(v_units, 0) - v_out_units;
    -- The tolerance rounds a real balance; it does not create one. Applied to an
    -- empty holding it would hand every sold-out bucket 0.0001 units it never
    -- had — and since principal_withdrawn may be omitted, that is a withdrawal
    -- row (carrying any amount_vnd) against a holding that is gone.
    if new.units_withdrawn > v_left_units + (case when v_left_units > 0 then c_units_epsilon else 0 end) then
      raise exception 'withdrawal of % units exceeds the remaining balance of % units on this holding',
        new.units_withdrawn, v_left_units using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_withdrawal_within_balance() is
  'Refuses a withdrawal/sell that would take more principal or units than its holding still has, measured under a lock on the source so concurrent sells cannot both pass (#587).';

drop trigger if exists investment_transactions_withdrawal_balance on public.investment_transactions;
create trigger investment_transactions_withdrawal_balance
  -- Every column that decides WHICH balance the row is measured against, plus the
  -- two that say how much it takes:
  --   • transaction_type — the WHEN clause reads it, so without it a row could be
  --     staged as an investment carrying principal_withdrawn (an investment draws
  --     nothing down, so it is not measured) and then activated by a one-column
  --     update that never fired this trigger.
  --   • asset_type — it picks the fund-bucket branch over the parent branch.
  before insert or update of
    transaction_type, asset_type, principal_withdrawn, units_withdrawn,
    parent_transaction_id, fund_id, goal_id
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'withdrawal')
  execute function public.enforce_withdrawal_within_balance();
