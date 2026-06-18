-- Atomic edit for an accumulating ("Loại 2") book.
--
-- Goal and maturity are BOOK-level: every tranche shares them. The PUT route used
-- to enforce that with TWO sequential statements — update the edited row, then
-- cascade goal/expiry to the rest of the group. Those aren't one transaction, so
-- a failure between them could leave the edited row on a new goal/maturity while
-- its siblings keep the old one — a book split across goals, breaking the single-
-- goal / single-maturity invariant every book feature relies on.
--
-- This function does the whole edit in ONE transaction:
--   1) Cascade the book-level fields (goal_id, expiry_date) to EVERY tranche of
--      the group, including the edited row — one statement, so they can never
--      diverge across tranches.
--   2) Apply the tranche-level fields (amount, rate, date, notes) to the edited
--      row only.
-- Either both commit or neither does. Each field carries a `p_set_*` flag so the
-- route can express PATCH semantics (distinguish "leave unchanged" from "set to
-- NULL") for the nullable columns (goal_id, expiry_date, interest_rate, notes).
create or replace function public.update_deposit_book(
  p_tx_id uuid,
  p_set_goal boolean,       p_goal_id uuid,
  p_set_expiry boolean,     p_expiry_date date,
  p_set_amount boolean,     p_amount_vnd bigint,
  p_set_rate boolean,       p_interest_rate numeric,
  p_set_investment boolean, p_investment_date date,
  p_set_notes boolean,      p_notes text
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group uuid;
  v_row public.investment_transactions;
begin
  select deposit_group_id into v_group
    from public.investment_transactions
   where transaction_id = p_tx_id
   for update;
  if not found then
    raise exception 'update_deposit_book: transaction not found'
      using errcode = 'no_data_found';
  end if;
  if v_group is null then
    raise exception 'update_deposit_book: not an accumulating book tranche'
      using errcode = 'check_violation';
  end if;

  -- 1) Book-level fields cascade to the whole group atomically (one statement).
  if p_set_goal or p_set_expiry then
    update public.investment_transactions
       set goal_id     = case when p_set_goal   then p_goal_id     else goal_id end,
           expiry_date = case when p_set_expiry then p_expiry_date else expiry_date end,
           updated_at  = now()
     where deposit_group_id = v_group;
  end if;

  -- 2) Tranche-level fields apply to the edited row only.
  update public.investment_transactions
     set amount_vnd      = case when p_set_amount     then p_amount_vnd      else amount_vnd end,
         interest_rate   = case when p_set_rate       then p_interest_rate   else interest_rate end,
         investment_date = case when p_set_investment then p_investment_date else investment_date end,
         notes           = case when p_set_notes      then p_notes           else notes end,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_row;

  return v_row;
end;
$$;
