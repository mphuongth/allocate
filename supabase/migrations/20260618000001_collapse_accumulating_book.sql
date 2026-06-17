-- Book-level renewal for accumulating ("Loại 2") deposits: collapse N tranches
-- into ONE fresh term deposit at maturity.
--
-- An accumulating book is many investment_transactions rows sharing a
-- deposit_group_id (the anchor row self-groups: deposit_group_id = its own id),
-- all on one shared maturity, each tranche on its own locked rate. At maturity
-- every tranche pays out together, so the natural action is to settle the whole
-- book and re-deposit the total as a single lump — the renew flow's single-row
-- roll can't express this (it would move one tranche and orphan the rest), which
-- is why renew_term_deposit explicitly rejects a grouped row. This function is
-- the book counterpart.
--
-- It performs the whole collapse as ONE transaction:
--   1) Snapshot EVERY tranche as its own closed cycle (renewed_from = anchor),
--      writing the per-tranche interest the route computed so the goal-detail
--      History still tells the full "topped up N×, each earned X" story.
--   2) Re-parent each tranche's partial-withdrawal rows onto its snapshot, so a
--      withdrawal never stays attached to a live row and double-subtracts.
--   3) Roll the ANCHOR row forward in place to the new single-deposit cycle
--      (combined principal, new rate/maturity, deposit_group_id = NULL → it
--      becomes a plain term deposit that renews through the normal path next time).
--   4) Delete the non-anchor tranche rows (their value now lives in the lump and
--      their history in the snapshots).
--   5) Optionally fold this month's recurring saving in (combine flow), reusing
--      the same recurring_saving_fulfillments mechanism as renew_term_deposit.
--
-- Interest is NOT computed here: the route values each tranche with lib/finance's
-- single formula and passes (tranche_id → interest) parallel arrays down, so the
-- TS valuation stays the one source of truth (no SQL port to drift from it).
create or replace function public.collapse_accumulating_book(
  p_group_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_tranche_ids uuid[],
  p_tranche_interest bigint[],
  p_fulfill_saving_id uuid default null,
  p_fulfill_ym text default null,
  p_fulfill_amount bigint default null,
  p_fulfill_source text default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
  v_snapshot_id uuid;
  v_interest bigint;
  v_idx int;
  v_renewed public.investment_transactions;
begin
  -- Lock the anchor (the row whose group = its own id). Its existence with that
  -- exact shape proves p_group_id names a real accumulating book the caller owns
  -- (RLS scopes the read to the user under security invoker).
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id
   for update;
  if not found then
    raise exception 'collapse_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'collapse_accumulating_book: only bank books can be collapsed'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'collapse_accumulating_book: amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'collapse_accumulating_book: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'collapse_accumulating_book: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 1–4) Snapshot, re-parent, then delete every tranche. We snapshot the anchor
  -- too (it is itself a closed cycle), then roll the anchor row forward after the
  -- loop. Iterating the live tranches under FOR UPDATE locks each before we touch
  -- it; deleting the non-anchor rows from inside the loop is safe (the loop reads
  -- a query snapshot, not a sensitive cursor).
  for v_tranche in
    select * from public.investment_transactions
     where deposit_group_id = p_group_id
       and transaction_type = 'investment'
       and renewed_from_transaction_id is null
     order by investment_date
     for update
  loop
    v_idx := array_position(p_tranche_ids, v_tranche.transaction_id);
    v_interest := case when v_idx is null then null else p_tranche_interest[v_idx] end;

    -- Snapshot this tranche's closed cycle (dates/amount/rate from the tranche),
    -- linked to the surviving anchor so buildRenewalSummary/History collect them.
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, amount_vnd,
      investment_date, expiry_date, interest_rate, notes,
      renewed_from_transaction_id, interest_earned_vnd, affects_progress
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false
    )
    returning transaction_id into v_snapshot_id;

    -- Re-parent this tranche's partial withdrawals onto its snapshot.
    update public.investment_transactions
       set parent_transaction_id = v_snapshot_id
     where parent_transaction_id = v_tranche.transaction_id
       and transaction_type = 'withdrawal';

    -- The anchor row survives (rolled forward below); every other tranche's value
    -- now lives in the lump, so remove the duplicate live row.
    if v_tranche.transaction_id <> p_group_id then
      delete from public.investment_transactions
       where transaction_id = v_tranche.transaction_id;
    end if;
  end loop;

  -- 3) Roll the anchor forward into the single fresh deposit. Clearing
  -- deposit_group_id turns the book into a plain term deposit (it renews through
  -- renew_term_deposit next time).
  update public.investment_transactions
     set amount_vnd        = p_amount_vnd,
         interest_rate     = p_interest_rate,
         expiry_date       = p_expiry_date,
         investment_date   = p_investment_date,
         deposit_group_id  = null,
         updated_at        = now()
   where transaction_id = p_group_id
  returning * into v_renewed;

  -- 5) Combine flow only: record this month's recurring saving as fulfilled so
  -- its amount (now folded into the lump) is not also counted as a synthesized
  -- contribution. Identical mechanism to renew_term_deposit's combine path.
  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_anchor.user_id
    ) then
      raise exception 'collapse_accumulating_book: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_anchor.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-collapse')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;
