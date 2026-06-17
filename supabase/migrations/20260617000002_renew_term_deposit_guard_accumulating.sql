-- Guard renew_term_deposit against accumulating ("Loại 2") books.
--
-- An accumulating book shares ONE maturity across many tranches (rows sharing a
-- deposit_group_id). renew_term_deposit rolls a SINGLE row forward, so renewing
-- a book's anchor would move just that row to a new cycle and leave the other
-- tranches on the old maturity/rate — shattering the "every tranche shares the
-- book's maturity" invariant the accumulating feature depends on. The API route
-- now rejects this, but the RPC is reachable directly by an authenticated
-- caller, so harden the function too (defence-in-depth, mirroring the flex-deposit
-- guard already here).
--
-- Body is otherwise identical to 20260616000002 (the fulfillment-aware renewal)
-- — see that migration and 20260614000001 for the full rationale on the coupled,
-- atomic writes.
create or replace function public.renew_term_deposit(
  p_tx_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_interest_earned_vnd bigint,
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
  v_old public.investment_transactions;
  v_snapshot_id uuid;
  v_renewed public.investment_transactions;
begin
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
  if v_old.interest_rate is null or v_old.expiry_date is null then
    raise exception 'renew_term_deposit: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  -- An accumulating book is renewed as a whole, not one tranche at a time.
  if v_old.deposit_group_id is not null then
    raise exception 'renew_term_deposit: cannot renew an accumulating book'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'renew_term_deposit: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'renew_term_deposit: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 1) Roll the active row forward to the new cycle.
  update public.investment_transactions
     set amount_vnd      = p_amount_vnd,
         interest_rate   = p_interest_rate,
         expiry_date     = p_expiry_date,
         investment_date = p_investment_date,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_renewed;

  -- 2) Append the history snapshot of the closed cycle (dates from v_old).
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

  -- 3) Re-parent the closed cycle's partial-withdrawal rows onto the snapshot.
  update public.investment_transactions
     set parent_transaction_id = v_snapshot_id
   where parent_transaction_id = p_tx_id
     and transaction_type = 'withdrawal';

  -- 4) Combine flow only: record this month's recurring saving as fulfilled.
  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_old.user_id
    ) then
      raise exception 'renew_term_deposit: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_old.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-combine')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;
