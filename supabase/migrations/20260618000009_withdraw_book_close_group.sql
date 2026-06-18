-- Fix: a FULL book close must actually settle the book, not just zero its value.
--
-- withdraw_accumulating_book (…007/…008) only wrote withdrawal rows — it never
-- touched deposit_group_id. So after a full close the anchor was still a "live
-- book" (deposit_group_id = its own id) worth 0. Closing one EARLY (before
-- maturity) that has a recurring link then lets the book come back from the dead:
-- next month the Plan "Saved" pill sees a non-matured book anchor + a live link
-- and tops it up (record_recurring_book_topup only guards matured), resurrecting a
-- book the user already settled. (At maturity the matured-guard hides it.)
--
-- Mirror collapse: when the withdrawal removes ALL remaining principal, clear
-- deposit_group_id on every tranche (the anchor is no longer a book, so
-- record_recurring_book_topup's `deposit_group_id = p_book_id` lookup misses → a
-- clean "book not found"), and null any recurring saving's link to it (the book it
-- fed is gone). A PARTIAL close leaves the book intact.
--
-- Body otherwise identical to …008.
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
