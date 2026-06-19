-- Add bank_code to the atomic accumulating-book edit (update_deposit_book).
--
-- bank_code is a BOOK-level field: every tranche of an accumulating book is the
-- same bank deposit, so the bank must cascade to the whole group exactly like
-- goal_id / expiry_date / notes — not apply to one tranche. Without this, editing
-- a book's bank via the PUT route (which routes books through this RPC) was
-- silently dropped.
--
-- IMPORTANT — two pitfalls this migration must avoid:
--   1) Adding parameters CHANGES the function signature, so a bare
--      `create or replace` would NOT replace the prior 13-arg version — it would
--      register a SECOND overload. Callers that still pass the old 13-arg set
--      (the assign route) then match both → "function is not unique" → 500. So we
--      DROP the exact old signature first, leaving exactly one function. The new
--      params keep DEFAULTS so the 13-arg callers resolve to it unchanged.
--   2) The previous definition is 20260618000005 (notes moved into the BOOK-level
--      cascade — a book's name), NOT 20260618000004 (notes tranche-level). This
--      recreate must preserve the 000005 behaviour (cascade notes) or a book
--      rename silently stops propagating. Book-level = goal, maturity, notes,
--      bank. Tranche-level = amount, rate, investment_date.
drop function if exists public.update_deposit_book(
  uuid, boolean, uuid, boolean, date, boolean, bigint,
  boolean, numeric, boolean, date, boolean, text
);

create or replace function public.update_deposit_book(
  p_tx_id uuid,
  p_set_goal boolean,       p_goal_id uuid,
  p_set_expiry boolean,     p_expiry_date date,
  p_set_amount boolean,     p_amount_vnd bigint,
  p_set_rate boolean,       p_interest_rate numeric,
  p_set_investment boolean, p_investment_date date,
  p_set_notes boolean,      p_notes text,
  p_set_bank boolean default false, p_bank_code text default null
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

  -- 1) Book-level fields (goal, maturity, name, bank) cascade to the whole group
  -- atomically (one statement).
  if p_set_goal or p_set_expiry or p_set_notes or p_set_bank then
    update public.investment_transactions
       set goal_id     = case when p_set_goal   then p_goal_id     else goal_id end,
           expiry_date = case when p_set_expiry then p_expiry_date else expiry_date end,
           notes       = case when p_set_notes  then p_notes       else notes end,
           bank_code   = case when p_set_bank   then p_bank_code   else bank_code end,
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
