-- Treat an accumulating book's `notes` as a BOOK-level field (its name), so a
-- rename cascades to every tranche.
--
-- The book's displayed name is its anchor's `notes` (buildInvRows reads
-- anchor.notes), and top-ups never set notes — so notes functions as the book's
-- name, not a per-tranche annotation. The first cut of update_deposit_book
-- (20260618000004) cascaded goal_id + expiry_date but kept notes tranche-level,
-- leaving the name as the odd one out: editing it on a non-anchor row wouldn't
-- rename the book. Move notes into the book-level cascade so the whole group
-- shares one name, consistent with goal + maturity. Genuinely per-tranche fields
-- (amount, rate, investment_date) stay on the edited row.
--
-- Otherwise identical to 20260618000004.
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

  -- 1) Book-level fields (goal, maturity, name) cascade to the whole group
  -- atomically (one statement).
  if p_set_goal or p_set_expiry or p_set_notes then
    update public.investment_transactions
       set goal_id     = case when p_set_goal   then p_goal_id     else goal_id end,
           expiry_date = case when p_set_expiry then p_expiry_date else expiry_date end,
           notes       = case when p_set_notes  then p_notes       else notes end,
           updated_at  = now()
     where deposit_group_id = v_group;
  end if;

  -- 2) Genuinely per-tranche fields apply to the edited row only.
  update public.investment_transactions
     set amount_vnd      = case when p_set_amount     then p_amount_vnd      else amount_vnd end,
         interest_rate   = case when p_set_rate       then p_interest_rate   else interest_rate end,
         investment_date = case when p_set_investment then p_investment_date else investment_date end,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_row;

  return v_row;
end;
$$;
