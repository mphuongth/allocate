-- Keep recurring-book materialization on the same date-based policy as manual
-- top-ups (#638). A historical entry must be judged by p_investment_date, not
-- by the day it happens to be recorded.
create or replace function public.record_recurring_book_topup(
  p_book_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_investment_date date,
  p_saving_id uuid,
  p_ym text,
  p_plan_id uuid default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
begin
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_book_id
     and deposit_group_id = p_book_id
   for update;
  if not found then
    raise exception 'record_recurring_book_topup: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'record_recurring_book_topup: not a bank book'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'record_recurring_book_topup: amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'record_recurring_book_topup: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.recurring_savings
     where saving_id = p_saving_id and user_id = v_anchor.user_id
  ) then
    raise exception 'record_recurring_book_topup: recurring saving not found'
      using errcode = 'no_data_found';
  end if;

  -- The INSERT trigger applies the shared assertion using p_investment_date.
  -- Keep this SECURITY INVOKER RPC from calling that private helper directly:
  -- authenticated callers are deliberately not granted EXECUTE on it.

  -- Every tranche carries the book's terms, the lock window included: goal detail
  -- reads book metadata off whichever group row it has (the anchor may not be in
  -- the page it fetched), so a tranche missing the window would render the book
  -- as open and offer a top-up the trigger then refuses.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    deposit_group_id, plan_id, affects_progress, top_up_lock_days
  ) values (
    v_anchor.user_id, v_anchor.goal_id, 'bank', 'investment', p_amount_vnd,
    p_investment_date, v_anchor.expiry_date, p_interest_rate, v_anchor.notes,
    p_book_id, p_plan_id, true, v_anchor.top_up_lock_days
  )
  returning * into v_tranche;

  insert into public.recurring_saving_fulfillments (
    user_id, recurring_saving_id, ym, amount_vnd, source
  ) values (
    v_anchor.user_id, p_saving_id, p_ym, p_amount_vnd, 'recurring-topup'
  )
  on conflict (recurring_saving_id, ym) do update
    set amount_vnd = excluded.amount_vnd,
        source     = excluded.source,
        updated_at = now();

  return v_tranche;
end;
$$;
