-- Atomic term-deposit renewal.
--
-- A renewal performs three coupled writes:
--   1. roll the active deposit row forward to the new cycle (in place),
--   2. append a history-only snapshot of the cycle that just closed,
--   3. re-parent that cycle's partial-withdrawal rows onto the snapshot.
--
-- Step 3 is correctness-critical, NOT best-effort: if it is skipped, the
-- withdrawal stays attached to the now-renewed active row via
-- parent_transaction_id and is subtracted from net worth a SECOND time (the
-- exact double-count this whole flow exists to prevent). Running the three as
-- separate statements from the API route left a window where the roll-forward +
-- snapshot could commit but the re-parent fail — the route would log and still
-- return 200, silently re-introducing the bug. This function runs all three in
-- one transaction, so they commit together or roll back together. A re-parent
-- failure now aborts the whole renewal and surfaces as an error.
--
-- SECURITY INVOKER (the default): every statement inside still runs under the
-- caller's row-level security, so a caller can only ever read/roll/re-parent
-- their OWN rows. search_path is pinned empty and all objects are schema-
-- qualified, per Supabase function-hardening guidance.
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
