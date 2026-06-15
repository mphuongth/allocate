-- Validate the renewal dates inside renew_term_deposit, and lock in that the
-- history snapshot keeps the CLOSED cycle's own dates.
--
-- Two changes vs 20260614000002 (the flex guard); the three coupled, atomic
-- writes are otherwise identical — see 20260614000001 for their full rationale.
--
-- 1. Date validation (defence-in-depth; the API route checks these too, but the
--    RPC is reachable directly by an authenticated caller):
--      * the new maturity must fall strictly AFTER the new cycle's start
--        (investment) date — otherwise the cycle has zero/negative length;
--      * the investment date may not be in the future. The client now anchors it
--        to the OLD maturity date (so an overdue book's new cycle does not lose
--        the days it sat past maturity); an actionable deposit's old maturity is
--        at most "tomorrow", so allow one day of client/server timezone skew
--        (mirroring lib/dates.isFutureInvestmentDate) and reject only beyond it.
--
-- 2. Snapshot lineage: step 2 builds the history snapshot from `v_old`, captured
--    by the `select ... for update` BEFORE the step-1 roll-forward. That is the
--    point of reading into v_old first — the snapshot records the closed cycle's
--    real open date and maturity (v_old.investment_date / v_old.expiry_date), and
--    is unaffected by the active row's investment_date now becoming the old
--    maturity. The snapshot must NEVER take p_investment_date / p_expiry_date,
--    which describe the NEW cycle.
create or replace function public.renew_term_deposit(
  p_tx_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_interest_earned_vnd bigint
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.investment_transactions;
  v_snapshot_id uuid;
  v_renewed public.investment_transactions;
begin
  -- Lock + read the active row. RLS restricts this to the caller's own row, so
  -- a missing row means "not yours / does not exist".
  select * into v_old
    from public.investment_transactions
   where transaction_id = p_tx_id
   for update;
  if not found then
    raise exception 'renew_term_deposit: transaction not found'
      using errcode = 'no_data_found';
  end if;
  if v_old.asset_type is distinct from 'bank' then
    raise exception 'renew_term_deposit: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  -- A term deposit carries both a rate and a maturity; a flexible deposit has
  -- neither and cannot be renewed.
  if v_old.interest_rate is null or v_old.expiry_date is null then
    raise exception 'renew_term_deposit: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  -- The investment date may not be in the future (allow one day of timezone
  -- skew, matching the route's lenient client-vs-server "today" tolerance).
  if p_investment_date > current_date + 1 then
    raise exception 'renew_term_deposit: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  -- The new cycle must have positive length: maturity strictly after the start.
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'renew_term_deposit: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 1) Roll the active row forward to the new cycle (valuation unchanged).
  update public.investment_transactions
     set amount_vnd      = p_amount_vnd,
         interest_rate   = p_interest_rate,
         expiry_date     = p_expiry_date,
         investment_date = p_investment_date,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_renewed;

  -- 2) Append the history snapshot of the cycle that just closed, linked to the
  --    still-active row. Excluded from every total by renewed_from_transaction_id.
  --    Dates come from v_old (pre-roll-forward) so the snapshot keeps the CLOSED
  --    cycle's real open + maturity dates — never the new p_* dates.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    renewed_from_transaction_id, interest_earned_vnd, affects_progress
  ) values (
    v_old.user_id, v_old.goal_id, 'bank', 'investment', v_old.amount_vnd,
    v_old.investment_date, v_old.expiry_date, v_old.interest_rate, v_old.notes,
    p_tx_id, p_interest_earned_vnd, false
  )
  returning transaction_id into v_snapshot_id;

  -- 3) Re-parent the closed cycle's partial-withdrawal rows onto the snapshot so
  --    they stop being subtracted from the renewed active row (its principal
  --    already excludes them). The snapshot is excluded from all totals, so the
  --    withdrawals are preserved in history without affecting valuation.
  update public.investment_transactions
     set parent_transaction_id = v_snapshot_id
   where parent_transaction_id = p_tx_id
     and transaction_type = 'withdrawal';

  return v_renewed;
end;
$$;

grant execute on function public.renew_term_deposit(uuid, bigint, numeric, date, date, bigint) to authenticated;
