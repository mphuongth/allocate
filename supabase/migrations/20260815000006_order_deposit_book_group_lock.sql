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
-- collapse_accumulating_book is recreated below for the same reason, one level
-- up: it took the anchor first and the tranches afterwards, which crosses an
-- id-ordered sweep whenever the anchor's id does not sort first. With
-- update_deposit_book and merge_book_into_successor (#649) both on id order,
-- anchor-first is the odd convention out, and converging on one order is the
-- only way any of this composes. Its body is 20260815000005's — marker included,
-- which the db suite checks by collapsing a book for real.
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
  v_seen bigint;
  v_now bigint;
  v_round int;
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
  --
  -- SWEPT UNTIL THE MEMBERSHIP STOPS MOVING, which one sweep does not give at
  -- READ COMMITTED. The statement's snapshot is fixed before it starts waiting,
  -- so a tranche a top-up inserts WHILE the sweep is queued behind that top-up's
  -- own anchor lock is invisible to it — and the book-level UPDATE below takes a
  -- fresh snapshot, sees the newcomer, and locks it in plan order. That is the
  -- cycle back, one row at a time.
  --
  -- The loop closes it because the sweep includes the ANCHOR, and every writer
  -- that adds a tranche takes the anchor first
  -- (assert_accumulating_book_topup_allowed): once a sweep completes, no further
  -- top-up can land, so the second pass is over a set that can no longer grow.
  -- The count is read on its own fresh snapshot, after the locks are held, which
  -- is exactly the read the sweep could not do for itself.
  --
  -- Bounded rather than open: a loop that cannot converge is a hung request, and
  -- "reload and retry" is already this function's answer to a book that will not
  -- hold still.
  v_seen := -1;
  for v_round in 1 .. 5 loop
    select count(*) into v_now
      from public.investment_transactions
     where deposit_group_id = v_group;
    exit when v_now = v_seen;
    perform 1
      from public.investment_transactions
     where deposit_group_id = v_group
     order by transaction_id
       for update;
    v_seen := v_now;
  end loop;
  if v_now is distinct from v_seen then
    raise exception 'update_deposit_book: book changed since load, reload and retry';
  end if;

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
create or replace function public.collapse_accumulating_book(
  p_group_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_tranche_ids uuid[],
  p_tranche_interest bigint[],
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
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
  v_snapshot_id uuid;
  v_interest bigint;
  v_idx int;
  v_renewed public.investment_transactions;
begin
  -- THE THIRD CHANGE FROM 20260618000003, and the reason this function is here
  -- again: it used to lock the ANCHOR first and the tranches afterwards, which
  -- crosses a writer taking the group in transaction_id order whenever the
  -- anchor's id does not happen to sort first. update_deposit_book above is now
  -- one such writer, and merge_book_into_successor has been another since #649,
  -- so the anchor-first order is the odd one out and it is this one that moves.
  --
  -- Read without a lock, sweep the whole group in id order, then re-read under
  -- that lock — the same three steps update_deposit_book takes, for the same
  -- reason. No loop-until-stable here: a tranche that arrives late is already
  -- fatal to a collapse and says so (the caller's tranche list would not account
  -- for it), which is a stronger answer than locking it.
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id;
  if not found then
    raise exception 'collapse_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;

  perform 1
    from public.investment_transactions
   where deposit_group_id = p_group_id
   order by transaction_id
     for update;

  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id;
  if not found then
    raise exception 'collapse_accumulating_book: book changed since load, reload and retry';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'collapse_accumulating_book: only bank books can be collapsed'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'collapse_accumulating_book: amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'collapse_accumulating_book: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'collapse_accumulating_book: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 0) Preserve EXPLICIT recurring links (#348): re-point any link that targets a
  -- tranche of this book onto the surviving anchor BEFORE the deletes below.
  update public.recurring_savings
     set linked_deposit_tx_id = p_group_id,
         updated_at = now()
   where user_id = v_anchor.user_id
     and linked_deposit_tx_id in (
       select transaction_id from public.investment_transactions
        where deposit_group_id = p_group_id
          and transaction_type = 'investment'
          and renewed_from_transaction_id is null
     );

  -- 1–4) Snapshot, re-parent, then delete every tranche; roll the anchor forward
  -- after the loop.
  --
  -- THE FIRST OF THE TWO CHANGES FROM 20260618000003. The deletes below, and the
  -- lineage move the delete guard makes on their behalf, are refused unless a
  -- collapse says it is doing them (#652). Nothing else sets this flag and no
  -- client can. Dropping this line breaks the collapse of any book holding
  -- another book's payout — pinned by merge_successor_book.test.sql.
  perform set_config('app.collapse_write', '1', true);
  for v_tranche in
    select * from public.investment_transactions
     where deposit_group_id = p_group_id
       and transaction_type = 'investment'
       and renewed_from_transaction_id is null
     order by investment_date
     for update
  loop
    v_idx := array_position(p_tranche_ids, v_tranche.transaction_id);
    -- A live tranche the caller didn't account for ⇒ the book changed since the
    -- route read it (e.g. a top-up landed mid-flight). Abort so its principal is
    -- never silently dropped; the client reloads and retries.
    if v_idx is null then
      -- NB: a plain raise (errcode P0001), NOT serialization_failure (40001) — the
      -- latter is conventionally auto-retried by drivers/poolers, which would spin
      -- on this deterministic abort instead of surfacing it. The route maps this
      -- message to a 409 so the client reloads.
      raise exception 'collapse_accumulating_book: book changed since load, reload and retry';
    end if;
    v_interest := p_tranche_interest[v_idx];

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, amount_vnd,
      investment_date, expiry_date, interest_rate, notes,
      renewed_from_transaction_id, interest_earned_vnd, affects_progress
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false
    )
    returning transaction_id into v_snapshot_id;

    update public.investment_transactions
       set parent_transaction_id = v_snapshot_id
     where parent_transaction_id = v_tranche.transaction_id
       and transaction_type = 'withdrawal';

    if v_tranche.transaction_id <> p_group_id then
      delete from public.investment_transactions
       where transaction_id = v_tranche.transaction_id;
    end if;
  end loop;
  -- Cleared immediately: the licence covers the loop, not the rest of whatever
  -- transaction this call happens to be in.
  perform set_config('app.collapse_write', '', true);

  update public.investment_transactions
     set amount_vnd        = p_amount_vnd,
         interest_rate     = p_interest_rate,
         expiry_date       = p_expiry_date,
         investment_date   = p_investment_date,
         deposit_group_id  = null,
         updated_at        = now()
   where transaction_id = p_group_id
  returning * into v_renewed;

  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_anchor.user_id
    ) then
      raise exception 'collapse_accumulating_book: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_anchor.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-collapse')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;
