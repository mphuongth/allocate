-- update_deposit_book takes its group in a defined order (#653).
--
-- The RPC locked the tranche it was handed and then rewrote the whole group in
-- one statement with no ORDER BY:
--
--   select deposit_group_id into v_group … where transaction_id = p_tx_id for update;
--   update public.investment_transactions … where deposit_group_id = v_group;
--
-- A bare UPDATE locks each row as the plan returns it, so the group's locks were
-- taken in physical order — an edge against anything that takes the same rows in
-- a defined one. merge_book_into_successor (#649) was moved to a single ordered
-- acquisition precisely to remove ITS half of that cycle, and half a cycle
-- removed is not a cycle removed: two concurrent edits of one book invert
-- against each other just as well, and the result reaches the user as a raw
-- 40P01 behind a generic 500.
--
-- Ordered by transaction_id, matching the merge and the pairing checks. Low
-- likelihood on a single-user app; the cost of agreeing on an order is one
-- statement.
--
-- ── the first lock had to move, not just gain an ORDER BY ────────────────────
--
-- Adding `order by transaction_id` to a second acquisition would not have fixed
-- anything while the row the caller named was still locked FIRST: that single
-- lock is itself out of order, so an edit naming the last tranche and one naming
-- the first would still cross. So the tranche is now READ without a lock, and
-- the whole group — including that row — is taken in one ordered sweep.
--
-- What the unlocked read gives up is re-read under the lock: if the row is gone,
-- or has left this book, the sweep would have locked the wrong set. Nothing
-- legitimate does either (20260802000002 pins a tranche to its book, and only a
-- dissolution clears the group, as a whole), so this is a re-check rather than a
-- new rule — and it answers with "reload and retry" instead of writing to a book
-- that no longer exists, which is what the collapse says in the same situation.
--
-- Body is otherwise 20260620000002's unchanged: book-level fields (goal,
-- maturity, notes, bank) cascade to the group, per-tranche fields (amount, rate,
-- investment date) apply to the named row. Same signature, so create-or-replace
-- needs no DROP.

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
  -- Read, do not lock: locking this row first would be one acquisition outside
  -- the order everything else agrees on, which is the cycle this is closing.
  select deposit_group_id into v_group
    from public.investment_transactions
   where transaction_id = p_tx_id;
  if not found then
    raise exception 'update_deposit_book: transaction not found'
      using errcode = 'no_data_found';
  end if;
  if v_group is null then
    raise exception 'update_deposit_book: not an accumulating book tranche'
      using errcode = 'check_violation';
  end if;

  -- The whole group, in transaction_id order, before anything is written — the
  -- same order merge_book_into_successor and the pairing checks take it in, so
  -- two writers queue instead of crossing.
  perform 1
    from public.investment_transactions
   where deposit_group_id = v_group
   order by transaction_id
     for update;

  -- Re-read under the lock. The group was read without one, so a book that was
  -- dissolved (or a tranche that left it) in between would have sent the sweep
  -- at the wrong set of rows. Nothing legitimate does that — a tranche is pinned
  -- to its book and a dissolution clears the whole group in one statement — so
  -- this is a re-check, answered the way the collapse answers the same race.
  if not exists (
    select 1 from public.investment_transactions
     where transaction_id = p_tx_id and deposit_group_id = v_group
  ) then
    raise exception 'update_deposit_book: book changed since load, reload and retry';
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
