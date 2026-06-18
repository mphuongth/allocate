-- Generalize withdraw_accumulating_book to support a PARTIAL close, spread across
-- tranches proportionally.
--
-- The first cut (20260618000007) only did a full close (every tranche's full
-- principal). This adds p_withdraw_principal — the principal amount to remove —
-- and splits it across the live tranches in proportion to each tranche's
-- principal, so a partial withdrawal leaves the book's blended rate and tranche
-- mix unchanged. A full close is just p_withdraw_principal = total principal.
--
-- Both the principal split and the cash (p_total_received) split use a cumulative
-- window so the per-tranche figures sum EXACTLY to the requested totals (no
-- rounding drift): allocated_i = round(T·cum_i/total) − round(T·cum_{i−1}/total).
-- net worth nets on principal_withdrawn; amount_vnd is the cash for P&L / activity.
drop function if exists public.withdraw_accumulating_book(uuid, bigint, date, boolean);

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

  -- Live tranches with their effective (post-withdrawal) principal.
  create temporary table _book_live on commit drop as
  select t.transaction_id, t.user_id, t.goal_id, t.investment_date,
         t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'
         ), 0) as eff
    from public.investment_transactions t
   where t.deposit_group_id = p_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null;
  delete from _book_live where eff <= 0;

  select coalesce(sum(eff), 0) into v_total_principal from _book_live;
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

  -- Proportional split, exact via the cumulative-window difference. Drop tranches
  -- whose rounded share is 0 (a small partial may not touch every tranche).
  with ranked as (
    select transaction_id, user_id, goal_id, eff,
           sum(eff) over (order by investment_date, transaction_id
                          rows between unbounded preceding and current row) as cum
      from _book_live
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
  return v_inserted;
end;
$$;
