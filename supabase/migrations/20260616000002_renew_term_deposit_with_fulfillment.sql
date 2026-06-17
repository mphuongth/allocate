-- Extend renew_term_deposit to (optionally) record a recurring-saving
-- fulfillment in the SAME transaction as the renewal.
--
-- The "settle & re-deposit (merge recurring)" combine flow folds this month's
-- recurring bank saving into the renewed deposit's principal. Two writes must
-- then happen together-or-not-at-all:
--   • the deposit rolls forward with the larger (combined) principal, and
--   • the recurring saving is marked fulfilled for that month.
-- If only the first landed, the folded-in amount would be counted twice (once in
-- the deposit principal, once as the still-synthesized recurring contribution) —
-- the exact double-count this flow exists to prevent. So the fulfillment upsert
-- joins the three existing coupled writes inside this one atomic function.
--
-- The four p_fulfill_* params default NULL, so plain (non-combine) renewals call
-- this unchanged. CREATE OR REPLACE cannot change a function's signature, so the
-- old 6-arg overload is dropped first — leaving both would make a 6-named-arg
-- call ambiguous against this 10-arg version's defaults.
drop function if exists public.renew_term_deposit(uuid, bigint, numeric, date, date, bigint);

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

  -- 4) Combine flow only: record that this month's recurring saving was folded
  --    into the re-deposit, so the dashboard suppresses its synthesized
  --    contribution instead of counting the amount a second time. Verify the
  --    saving belongs to this user (the FK alone doesn't bind ownership), then
  --    upsert — re-combining the same month is idempotent.
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

grant execute on function public.renew_term_deposit(
  uuid, bigint, numeric, date, date, bigint, uuid, text, bigint, text
) to authenticated;
