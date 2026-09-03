-- An accumulating book keeps the bank it sat at, and can be moved to another.
--
-- collapse_accumulating_book was the only cycle-closing path that never learned
-- about bank_code, and that single omission showed up as two separate defects.
--
--   • Its per-tranche snapshot INSERT names its columns explicitly, and bank_code
--     was not among them — so collapsing a book erased, from every closed cycle,
--     the record of where that money had been. Quiet history loss on its own; and
--     if the collapsed row is ever deleted, ON DELETE SET NULL hands those
--     snapshots back as live holdings with no bank at all. That is the state the
--     PVcomBank incident left behind, and why the fix belongs next to
--     20260903000001 rather than after it.
--   • It took no destination bank, so a matured book could not be re-deposited
--     elsewhere. #640 closed exactly this gap for a lone deposit; the book path
--     was left behind, and MaturityResolveSheet hid its picker for books BECAUSE
--     of this signature — a missing RPC argument surfacing to the user as a
--     missing control.
--
-- Adding a parameter changes the signature, so the prior 11-arg version is
-- DROPPED first: a bare create-or-replace registers a second overload and makes
-- PostgREST's name-resolved calls ambiguous (the pitfall 20260620000003 records).
--
-- Copied from 20260817000002, the current definition, and changed in exactly the
-- three places marked below. Re-issuing from an older revision silently reverts
-- the `app.collapse_write` marker (#652) and the merged_from_book_id carry
-- (#656), both of which have their own tests.
--
-- Covered by supabase/tests/collapse_destination_bank.test.sql (`npm run test:db`).

drop function if exists public.collapse_accumulating_book(
  uuid, bigint, numeric, date, date, uuid[], bigint[], uuid, text, bigint, text
);

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
  p_fulfill_source text default null,
  -- Where the collapsed deposit lands. NULL = leave the book's own bank alone,
  -- the same reading renew_term_deposit_with_merge gives it, so a caller that
  -- offers no picker — and a user who picks "no bank" — can never clear one.
  p_bank_code text default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
  v_seen bigint;
  v_now bigint;
  v_round int;
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
  -- Read without a lock, sweep the whole group in id order until its membership
  -- stops moving, then re-read under that lock — the same steps
  -- update_deposit_book takes, for the same reasons.
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id;
  if not found then
    raise exception 'collapse_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;

  -- Swept until the membership stops moving, for the reason spelled out on
  -- update_deposit_book above: at READ COMMITTED the sweep's snapshot predates
  -- its wait, so a tranche a top-up inserts while it is queued behind the anchor
  -- is invisible to it — and the loop below would then take that row's lock in
  -- investment_date order, outside the sweep. Refusing the collapse afterwards
  -- (the caller's list cannot account for it) is the right ANSWER but it comes
  -- after the lock, which is too late to matter for ordering.
  v_seen := -1;
  for v_round in 1 .. 5 loop
    select count(*) into v_now
      from public.investment_transactions
     where deposit_group_id = p_group_id;
    exit when v_now = v_seen;
    perform 1
      from public.investment_transactions
     where deposit_group_id = p_group_id
     order by transaction_id
       for update;
    v_seen := v_now;
  end loop;

  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id;
  if not found or v_now is distinct from v_seen then
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
      renewed_from_transaction_id, interest_earned_vnd, affects_progress,
      -- Which book paid for this tranche (#656): carried onto the snapshot
      -- because the tranche that held it is deleted two statements below, and
      -- the book's top-up strip goes with the cleared deposit_group_id — the
      -- History tab is the only surface a closed cycle still has.
      merged_from_book_id,
      -- THE FIRST CHANGE FROM 20260817000002. Where the cycle actually sat. This
      -- column list is explicit, so a column left out of it is dropped from every
      -- closed cycle — the history then says the money was at no bank, and the
      -- destination picker below would be describing a move from nowhere. It also
      -- decides what a snapshot looks like if it is ever handed back as a live
      -- row, which is precisely what the delete guard in 20260903000001 exists to
      -- stop happening by accident.
      bank_code
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false,
      v_tranche.merged_from_book_id,
      v_tranche.bank_code
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
         -- THE SECOND CHANGE FROM 20260817000002, and byte-identical to how
         -- renew_term_deposit_with_merge applies it: coalesce, so null leaves the
         -- book where it is.
         bank_code         = coalesce(p_bank_code, bank_code),
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
