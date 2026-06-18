-- Close a whole accumulating ("Loại 2") book to cash, atomically.
--
-- A single withdrawal row parents to ONE tranche, so withdrawing a book the
-- normal way would under-subtract (the amount can't spill across tranches) — which
-- is why book withdrawal was blocked. A FULL close needs no spreading policy: write
-- one withdrawal row per live tranche at its full effective (post-withdrawal)
-- principal, so every tranche nets to zero and the book drops out of the holdings.
-- All rows commit together. (Partial book withdrawal — an arbitrary amount spread
-- across tranches by a policy — is a separate, later piece.)
--
-- The user-entered total cash received is split across the rows' amount_vnd in
-- proportion to each tranche's principal (a display figure for P&L / recent
-- activity — net worth nets on principal_withdrawn, not amount_vnd), so an
-- early-withdrawal penalty or the bank's exact payout is reflected.
create or replace function public.withdraw_accumulating_book(
  p_book_id uuid,
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
  v_count integer;
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
  select t.transaction_id, t.user_id, t.goal_id,
         t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'
         ), 0) as eff
    from public.investment_transactions t
   where t.deposit_group_id = p_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null;
  delete from _book_live where eff <= 0;

  select coalesce(sum(eff), 0), count(*) into v_total_principal, v_count from _book_live;
  if v_count = 0 or v_total_principal <= 0 then
    raise exception 'withdraw_accumulating_book: nothing to withdraw'
      using errcode = 'check_violation';
  end if;

  -- One withdrawal row per live tranche: full principal out, cash split by share.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress
  )
  select user_id, goal_id, 'bank', 'withdrawal', transaction_id,
         p_investment_date,
         round(p_total_received::numeric * eff / v_total_principal),
         eff, p_affects_progress
    from _book_live;

  return v_count;
end;
$$;
