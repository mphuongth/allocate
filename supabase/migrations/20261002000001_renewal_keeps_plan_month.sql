-- A renewal must not rewrite the month a deposit was saved in.
--
-- Planning credits a month with the bank deposits that carry its plan_id, at
-- their amount_vnd. A renewal rolls the live row forward IN PLACE — new
-- principal, plus interest, plus any merged cash — and that row kept the
-- plan_id of the month it was first opened. So the month's "contributed" grew
-- with every renewal: 10M saved in January read 10.3M after one renewal and
-- 10.6M after two. Collapsing an accumulating book was worse: each top-up
-- tranche carried its own month's plan_id and the collapse deletes the tranche,
-- so those months lost their contribution while the anchor's month took the
-- whole book.
--
-- The month belongs to the money saved in it — the cycle opened then. So the
-- snapshot of the closed cycle keeps the plan_id, and the live row, a later
-- cycle funded by money already counted, carries none. Planning reads
-- investment_transactions by plan_id (snapshots included), so it then shows
-- each month what was saved in it, however often the deposit is renewed.
--
-- Each function below is its latest definition, byte for byte, except the
-- lines marked 20261002000001:
--   renew_term_deposit            — 20260617000002
--   renew_term_deposit_with_merge — 20260815000001
--   collapse_accumulating_book    — 20260904000001
--
-- The other ways a deposit closes keep the original rows (a withdrawal
-- closes them in place), so their months were never rewritten: the successor
-- merge (its credited tranche is the book's payout, rightly with no month) and
-- the book withdrawal.

-- ── renew_term_deposit ───────────────────────────────────────────────────────

create or replace function public.renew_term_deposit(
  p_tx_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_interest_earned_vnd bigint,
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
  v_old public.investment_transactions;
  v_snapshot_id uuid;
  v_renewed public.investment_transactions;
begin
  select * into v_old
    from public.investment_transactions
   where transaction_id = p_tx_id
   for update;
  if not found then
    raise exception 'renew_term_deposit: transaction not found'
      using errcode = 'no_data_found';
  end if;
  if v_old.asset_type is distinct from 'bank' then
    raise exception 'renew_term_deposit: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  if v_old.interest_rate is null or v_old.expiry_date is null then
    raise exception 'renew_term_deposit: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  -- An accumulating book is renewed as a whole, not one tranche at a time.
  if v_old.deposit_group_id is not null then
    raise exception 'renew_term_deposit: cannot renew an accumulating book'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'renew_term_deposit: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'renew_term_deposit: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 1) Roll the active row forward to the new cycle.
  update public.investment_transactions
     set amount_vnd      = p_amount_vnd,
         interest_rate   = p_interest_rate,
         expiry_date     = p_expiry_date,
         investment_date = p_investment_date,
         -- 20261002000001: the new cycle is funded by money an earlier month
         -- already saved, so it carries no month of its own.
         plan_id         = null,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_renewed;

  -- 2) Append the history snapshot of the closed cycle (dates from v_old).
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    renewed_from_transaction_id, interest_earned_vnd, affects_progress,
    -- 20261002000001: the closed cycle keeps the month it was saved in.
    plan_id
  ) values (
    v_old.user_id, v_old.goal_id, 'bank', 'investment', v_old.amount_vnd,
    v_old.investment_date, v_old.expiry_date, v_old.interest_rate, v_old.notes,
    p_tx_id, p_interest_earned_vnd, false,
    v_old.plan_id
  )
  returning transaction_id into v_snapshot_id;

  -- 3) Re-parent the closed cycle's partial-withdrawal rows onto the snapshot.
  update public.investment_transactions
     set parent_transaction_id = v_snapshot_id
   where parent_transaction_id = p_tx_id
     and transaction_type = 'withdrawal';

  -- 4) Combine flow only: record this month's recurring saving as fulfilled.
  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_old.user_id
    ) then
      raise exception 'renew_term_deposit: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_old.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-combine')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;

-- ── renew_term_deposit_with_merge ────────────────────────────────────────────

create or replace function public.renew_term_deposit_with_merge(
  p_tx_id uuid,
  p_amount_vnd bigint,            -- BASE only; the RPC adds Σ(received) + Σ(held)
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_interest_earned_vnd bigint,
  p_fulfill_saving_id uuid default null,
  p_fulfill_ym text default null,
  p_fulfill_amount bigint default null,
  p_fulfill_source text default null,
  p_merge_source_ids uuid[] default '{}',
  p_merge_received bigint[] default '{}',
  p_bank_code text default null,
  p_held_source_ids uuid[] default '{}'
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.investment_transactions;
  v_snapshot_id uuid;
  v_renewed public.investment_transactions;
  v_src public.investment_transactions;
  v_sid uuid;
  v_recv bigint;
  v_src_eff bigint;
  v_merge_total bigint := 0;
  v_n integer;
  v_i integer;
  v_hn integer;
  v_hid uuid;
begin
  select * into v_old
    from public.investment_transactions
   where transaction_id = p_tx_id
   for update;
  if not found then
    raise exception 'renew_term_deposit_with_merge: transaction not found'
      using errcode = 'no_data_found';
  end if;
  if v_old.asset_type is distinct from 'bank' then
    raise exception 'renew_term_deposit_with_merge: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  if v_old.interest_rate is null or v_old.expiry_date is null then
    raise exception 'renew_term_deposit_with_merge: only bank term deposits can be renewed'
      using errcode = 'check_violation';
  end if;
  -- An accumulating book is renewed as a whole, not one tranche at a time.
  if v_old.deposit_group_id is not null then
    raise exception 'renew_term_deposit_with_merge: cannot renew an accumulating book'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'renew_term_deposit_with_merge: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'renew_term_deposit_with_merge: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 0) Merge step (before roll-forward): close each LIVE source and accumulate the
  --    cash it releases. The withdrawals are parented to the SOURCE, not D, so
  --    step 3's re-parent (parent = p_tx_id) never touches them.
  v_n := coalesce(array_length(p_merge_source_ids, 1), 0);
  if v_n <> coalesce(array_length(p_merge_received, 1), 0) then
    raise exception 'renew_term_deposit_with_merge: merge source/received length mismatch'
      using errcode = 'check_violation';
  end if;
  -- Acquire every source row lock up front in a deterministic (sorted) order, so
  -- two concurrent merges that share a source can't deadlock by locking it in
  -- opposite array orders. The per-source `for update` in the loop below then
  -- just re-reads an already-held lock. (Low-risk for a single-user app, but
  -- cheap insurance against the ordering hazard.)
  perform 1
    from public.investment_transactions
   where transaction_id = any(p_merge_source_ids)
   order by transaction_id
     for update;
  for v_i in 1 .. v_n loop
    v_sid := p_merge_source_ids[v_i];
    v_recv := p_merge_received[v_i];
    if v_sid = p_tx_id then
      raise exception 'renew_term_deposit_with_merge: a deposit cannot merge into itself'
        using errcode = 'check_violation';
    end if;
    if v_recv is null or v_recv < 0 then
      raise exception 'renew_term_deposit_with_merge: received amount must be non-negative'
        using errcode = 'check_violation';
    end if;
    select * into v_src
      from public.investment_transactions
     where transaction_id = v_sid
     for update;
    if not found then
      raise exception 'renew_term_deposit_with_merge: merge source not found'
        using errcode = 'no_data_found';
    end if;
    -- Source must be a plain, active bank deposit owned by the same user and in
    -- the same goal as D (an internal transfer within one goal). Books, renewal
    -- snapshots and withdrawals are excluded.
    if v_src.user_id <> v_old.user_id then
      raise exception 'renew_term_deposit_with_merge: merge source belongs to another user'
        using errcode = 'check_violation';
    end if;
    if v_src.goal_id is distinct from v_old.goal_id then
      raise exception 'renew_term_deposit_with_merge: merge source is in a different goal'
        using errcode = 'check_violation';
    end if;
    if v_src.asset_type is distinct from 'bank' or v_src.deposit_group_id is not null
       or v_src.transaction_type is distinct from 'investment'
       or v_src.renewed_from_transaction_id is not null then
      raise exception 'renew_term_deposit_with_merge: merge source is not a plain active bank deposit'
        using errcode = 'check_violation';
    end if;
    -- Close only what is left after any prior partial withdrawals.
    v_src_eff := v_src.amount_vnd - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.parent_transaction_id = v_sid and w.transaction_type = 'withdrawal'
    ), 0);
    if v_src_eff <= 0 then
      raise exception 'renew_term_deposit_with_merge: merge source is already fully withdrawn'
        using errcode = 'check_violation';
    end if;
    -- Sanity-bound the cash received against the source's OWN value: settling S
    -- releases at most its effective principal plus interest, never a multiple of
    -- it. Without this the server trusts the client's received outright, so a
    -- buggy/malicious caller could inflate D (principal = BASE + Σ received) from
    -- nothing while S only closes its real principal. Mirror the ×10 bound the
    -- renewal route already applies to interest_earned_vnd — generous enough to
    -- never reject a real held-to-maturity value, tight enough to cap abuse.
    if v_recv > v_src_eff * 10 then
      raise exception 'renew_term_deposit_with_merge: received amount is unreasonably large for the source'
        using errcode = 'check_violation';
    end if;
    -- Stamp the withdrawal as folded into D (consumed_by_inv_id = D). Its cash now
    -- lives in D's principal, so deleting this row from the ledger would re-open the
    -- source at full value while the cash still sits in D — a double-count. The
    -- DELETE route guards any withdrawal carrying this marker (held OR live) with a
    -- 409. (This is the only change from 20260620000005.)
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
      investment_date, amount_vnd, principal_withdrawn, affects_progress, consumed_by_inv_id
    ) values (
      v_src.user_id, v_src.goal_id, 'bank', 'withdrawal', v_sid,
      p_investment_date, v_recv, v_src_eff, true, p_tx_id
    );
    -- Unlink any recurring saving that fed the now-closed source (mirror
    -- 20260618000009 lines 110–117) so nothing tries to top it up later.
    update public.recurring_savings
       set linked_deposit_tx_id = null, updated_at = now()
     where linked_deposit_tx_id = v_sid and user_id = v_old.user_id;
    v_merge_total := v_merge_total + v_recv;
  end loop;

  -- 0b) Held-pool consume: each held settlement already closed its source and
  --     parked the cash. Fold that cash into D and stamp it consumed — NO new
  --     withdrawal (the source is already closed; opening another would
  --     double-close it). The client passes ids only, so the released amount is
  --     the trusted stored amount_vnd, not a client value — no ×10 bound needed.
  v_hn := coalesce(array_length(p_held_source_ids, 1), 0);
  perform 1
    from public.investment_transactions
   where transaction_id = any(p_held_source_ids)
   order by transaction_id
     for update;
  for v_i in 1 .. v_hn loop
    v_hid := p_held_source_ids[v_i];
    if v_hid = p_tx_id then
      raise exception 'renew_term_deposit_with_merge: a deposit cannot merge into itself'
        using errcode = 'check_violation';
    end if;
    select * into v_src
      from public.investment_transactions
     where transaction_id = v_hid
     for update;
    if not found then
      raise exception 'renew_term_deposit_with_merge: held source not found'
        using errcode = 'no_data_found';
    end if;
    if v_src.user_id <> v_old.user_id then
      raise exception 'renew_term_deposit_with_merge: held source belongs to another user'
        using errcode = 'check_violation';
    end if;
    if v_src.transaction_type is distinct from 'withdrawal' or coalesce(v_src.held_for_merge, false) = false then
      raise exception 'renew_term_deposit_with_merge: source is not a held settlement'
        using errcode = 'check_violation';
    end if;
    if v_src.consumed_by_inv_id is not null then
      raise exception 'renew_term_deposit_with_merge: held source already consumed'
        using errcode = 'check_violation';
    end if;
    if v_src.goal_id is distinct from v_old.goal_id then
      raise exception 'renew_term_deposit_with_merge: held source is in a different goal'
        using errcode = 'check_violation';
    end if;
    -- THE ONE CHANGE FROM 20260809000001. Nothing else may write this marker
    -- (see the trigger at the foot of this file), so the merge marks its own
    -- write — the same instrument successor_deposit_tx_id uses. Cleared right
    -- after, so the flag covers this statement and nothing further in the
    -- transaction. A recreation of this function that drops these two lines
    -- breaks every held merge; the db suite runs one, so it breaks in CI.
    perform set_config('app.held_merge', '1', true);
    update public.investment_transactions
       set consumed_by_inv_id = p_tx_id, updated_at = now()
     where transaction_id = v_hid;
    perform set_config('app.held_merge', '', true);
    -- Backstop the hold-time unlink (POST clears it when the holding is created):
    -- a recurring saving linked to the now-consumed source must not keep pointing
    -- at it. The held row's parent IS that source deposit; clear any link to it.
    update public.recurring_savings
       set linked_deposit_tx_id = null, updated_at = now()
     where linked_deposit_tx_id = v_src.parent_transaction_id and user_id = v_old.user_id;
    v_merge_total := v_merge_total + v_src.amount_vnd;
  end loop;

  -- 1) Roll the active row forward to the new cycle. Net-worth invariant: the
  --    amount added to D's principal equals exactly Σ(received) + Σ(held) the
  --    sources released — the server adds it so the client can never inflate D
  --    alone. bank_code moves to the chosen destination; NULL leaves it as is.
  update public.investment_transactions
     set amount_vnd      = p_amount_vnd + v_merge_total,
         interest_rate   = p_interest_rate,
         expiry_date     = p_expiry_date,
         investment_date = p_investment_date,
         bank_code       = coalesce(p_bank_code, bank_code),
         -- Relabel only a bank-DERIVED name: the notes must read as some bank's
         -- name (case-insensitively). A name the user typed is left alone.
         notes           = case
           when p_bank_code is not null
            and p_bank_code is distinct from v_old.bank_code
            and exists (
                  select 1 from public.banks b
                   where lower(btrim(v_old.notes)) = lower(b.name)
                )
           then (select b.name from public.banks b where b.code = p_bank_code)
           else notes
         end,
         -- 20261002000001: the new cycle is funded by money earlier months
         -- already saved (this deposit's, and any merged source's), so it
         -- carries no month of its own.
         plan_id         = null,
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_renewed;

  -- 2) Append the history snapshot of the closed cycle (dates from v_old).
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    renewed_from_transaction_id, interest_earned_vnd, affects_progress,
    -- 20261002000001: the closed cycle keeps the month it was saved in.
    plan_id
  ) values (
    v_old.user_id, v_old.goal_id, 'bank', 'investment', v_old.amount_vnd,
    v_old.investment_date, v_old.expiry_date, v_old.interest_rate, v_old.notes,
    p_tx_id, p_interest_earned_vnd, false,
    v_old.plan_id
  )
  returning transaction_id into v_snapshot_id;

  -- 3) Re-parent the closed cycle's partial-withdrawal rows onto the snapshot.
  update public.investment_transactions
     set parent_transaction_id = v_snapshot_id
   where parent_transaction_id = p_tx_id
     and transaction_type = 'withdrawal';

  -- 4) Combine flow only: record this month's recurring saving as fulfilled.
  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_old.user_id
    ) then
      raise exception 'renew_term_deposit_with_merge: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_old.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-combine')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;

-- ── collapse_accumulating_book ───────────────────────────────────────────────

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
      bank_code,
      -- 20261002000001: each tranche keeps the month it was saved in — the
      -- tranche itself is deleted below, so without this its month loses the
      -- contribution outright.
      plan_id
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false,
      v_tranche.merged_from_book_id,
      v_tranche.bank_code,
      v_tranche.plan_id
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
         -- 20261002000001: the collapsed deposit is funded by months already
         -- counted on their own tranches' snapshots, so it carries none.
         plan_id           = null,
         -- THE SECOND CHANGE FROM 20260817000002, and byte-identical to how
         -- renew_term_deposit_with_merge applies it: coalesce, so null leaves the
         -- book where it is.
         bank_code         = coalesce(p_bank_code, bank_code),
         -- THE ONLY CHANGE FROM 20260903000002, and byte-identical to how
         -- renew_term_deposit_with_merge has relabelled since 20260809000001:
         -- a label that reads as SOME bank's name is bank-derived and follows
         -- the money; anything the user typed is left alone. v_anchor is the
         -- pre-update row, so the comparison is against the bank being left.
         notes             = case
           when p_bank_code is not null
            and p_bank_code is distinct from v_anchor.bank_code
            and exists (
                  select 1 from public.banks b
                   where lower(btrim(v_anchor.notes)) = lower(b.name)
                )
           then (select b.name from public.banks b where b.code = p_bank_code)
           else notes
         end,
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

-- ── repair: renewals made before this ────────────────────────────────────────
--
-- What they left: the live row holding the plan at its renewed amount, its
-- first cycle's snapshot holding none. The month goes back to the first cycle
-- — the money saved then, at the amount saved then.
--
-- For a book collapsed before this, that restores the anchor's own month. The
-- months of its other tranches cannot be restored: those tranches were deleted
-- with no record of which month they were saved in, and guessing it from a
-- date would be inventing history.
--
-- Kept as a function so the test can prove it on the shape it repairs; run
-- once here, and not callable by users.
create or replace function public.move_renewed_plan_month_to_first_cycle()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  with first_cycle as (
    select distinct on (s.renewed_from_transaction_id)
           s.transaction_id, s.renewed_from_transaction_id as live_id, s.plan_id
      from public.investment_transactions s
     where s.renewed_from_transaction_id is not null
     order by s.renewed_from_transaction_id, s.investment_date, s.created_at, s.transaction_id
  ), moved as (
    update public.investment_transactions snap
       set plan_id = live.plan_id
      from first_cycle fc
      join public.investment_transactions live on live.transaction_id = fc.live_id
     where snap.transaction_id = fc.transaction_id
       and fc.plan_id is null
       and live.plan_id is not null
       and live.renewed_from_transaction_id is null
    returning fc.live_id
  )
  update public.investment_transactions live
     set plan_id = null
   where live.transaction_id in (select live_id from moved);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.move_renewed_plan_month_to_first_cycle() from public, anon, authenticated;

select public.move_renewed_plan_month_to_first_cycle();
