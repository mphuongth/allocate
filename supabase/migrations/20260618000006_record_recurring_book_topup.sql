-- Materialize a recurring saving as a top-up into its linked accumulating book,
-- atomically.
--
-- A recurring saving can be linked (linked_deposit_tx_id) to a book's anchor.
-- "Recording" this month's recurring then means adding a real top-up tranche to
-- that book AND marking the recurring fulfilled for the month — both must happen
-- together. The tranche is a real bank row, so it also lands in the overview's
-- logged-deposit pool; the fulfillment row (saving_id, ym) is the reliable
-- suppressor of the synthesized contribution (realizedRecurringContributions
-- consumes the backing deposit on a fulfilled month, so it can't double-count).
-- Creating the tranche but missing the fulfillment would double-count the amount
-- — so they run in one transaction here, like the collapse / combine RPCs.
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
  -- The book anchor (deposit_group_id = its own id) carries the book's goal +
  -- maturity, copied down to the new tranche. Lock it for the insert.
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
  -- A matured book is closed: a tranche dated today would sit past the book's
  -- maturity and accrue zero interest. Block it (mirrors the top-up route guard).
  if v_anchor.expiry_date is not null and v_anchor.expiry_date < current_date then
    raise exception 'record_recurring_book_topup: cannot top up a matured book'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'record_recurring_book_topup: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  -- The recurring saving must belong to the caller (RLS scopes the read).
  if not exists (
    select 1 from public.recurring_savings
     where saving_id = p_saving_id and user_id = v_anchor.user_id
  ) then
    raise exception 'record_recurring_book_topup: recurring saving not found'
      using errcode = 'no_data_found';
  end if;

  -- 1) The top-up tranche — inherits the book's goal + maturity + name; carries
  -- its own locked rate + the plan_id (so By-goal "contributed" counts it).
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    deposit_group_id, plan_id, affects_progress
  ) values (
    v_anchor.user_id, v_anchor.goal_id, 'bank', 'investment', p_amount_vnd,
    p_investment_date, v_anchor.expiry_date, p_interest_rate, v_anchor.notes,
    p_book_id, p_plan_id, true
  )
  returning * into v_tranche;

  -- 2) Mark the recurring fulfilled for the month so the synthesized contribution
  -- is suppressed (and its backing deposit — this tranche — is reconciled).
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
