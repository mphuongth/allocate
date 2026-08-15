-- Only the merge may fold a held settlement in (#617).
--
-- consumed_by_inv_id is what takes a held settlement out of the pool: once
-- stamped, its cash lives in the destination deposit's principal and
-- heldForMergeContributions stops adding it. #616 closed the INFLATION
-- direction — clearing or repointing a marker that is already set, which would
-- have the pool synthesize cash that is already inside a deposit. The FIRST
-- stamp was left writable, and 20260731000001 records why: every way of asking
-- "which function is writing this" was judged worse than the gap.
--
--   update … set consumed_by_inv_id = <any owned deposit> where held_for_merge
--   → ACCEPTED: the parked cash leaves net worth and arrives in no deposit at
--     all. The dashboard's total assets simply fall by the settlement's amount.
--
-- It destroys value rather than fabricating it, and only the caller's own, which
-- is why it was not blocking. It is still a write no legitimate client makes:
-- nothing outside renew_term_deposit_with_merge writes this column — not the
-- routes (they read it), not the UI, not the other merge (merge_book_into_successor
-- stamps its own withdrawals as it INSERTS them, and those are not held rows).
--
-- What has changed since #616 is that the repo now has a proven instrument for
-- exactly this shape. successor_deposit_tx_id (#638, 20260811000001) is a column
-- only two functions may write, and the way it says so is a transaction-local
-- flag the writer sets around its own statement:
--
--   perform set_config('app.successor_write', '1', true);
--   update … ;
--   perform set_config('app.successor_write', '', true);
--
-- and a BEFORE trigger that refuses the write when the flag is absent AND there
-- is a session behind the statement (auth.uid() is not null — the service role,
-- migrations and SQL maintenance keep their reach, the same convention this file
-- and 20260811000001 both use). A REST caller cannot forge it: PostgREST issues
-- one statement per transaction and offers no way to run SET, so the flag is
-- only ever set by a function the server owns.
--
-- The three mechanisms #616 rejected are still rejected, for the reasons written
-- there — the PL/pgSQL call stack does not contain the caller, and a per-function
-- GUC (`alter function … set app.merge = 1`) is silently dropped by the next
-- `create or replace`, taking every merge in production down with it. This is the
-- third option, and the objection to it was the copy: marking its own write means
-- recreating renew_term_deposit_with_merge, ~280 lines whose next edit would not
-- reach the copy.
--
-- That objection is answered rather than ignored:
--
--   • the copy is how this function is edited anyway. 20260620000003,
--     20260620000005, 20260620000006, 20260807000001 and 20260809000001 are each
--     a full recreation of it; this is the sixth, forward-only, and the body below
--     is 20260809000001's unchanged except for the two marked lines. There is one
--     live definition, as before, not a fork.
--   • the failure it could cause is no longer silent. The db suite now RUNS a
--     held merge (held_settlement_source_backed.test.sql §13), so a future
--     recreation that drops the set_config fails CI on every PR instead of
--     failing merges in production — which is the half #616's call-stack attempt
--     got wrong and only the E2E caught.
--
-- The message the trigger raises names the missing line, so the fix is legible
-- from the failure alone.

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
         updated_at      = now()
   where transaction_id = p_tx_id
  returning * into v_renewed;

  -- 2) Append the history snapshot of the closed cycle (dates from v_old).
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes,
    renewed_from_transaction_id, interest_earned_vnd, affects_progress
  ) values (
    v_old.user_id, v_old.goal_id, 'bank', 'investment', v_old.amount_vnd,
    v_old.investment_date, v_old.expiry_date, v_old.interest_rate, v_old.notes,
    p_tx_id, p_interest_earned_vnd, false
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

grant execute on function public.renew_term_deposit_with_merge(
  uuid, bigint, numeric, date, date, bigint, uuid, text, bigint, text, uuid[], bigint[], text, uuid[]
) to authenticated;


-- ─── the marker is the merge's to write ──────────────────────────────────────
--
-- Both directions of the column are now closed for a session: 20260731000001's
-- investment_transactions_consumption_marker refuses clearing or repointing one
-- that is set, and this refuses setting one that is not.
--
-- INSERT is covered too. A settlement born already-consumed makes the same
-- claim in one statement — its source is closed by the row and its cash is
-- accounted to a deposit that never received it — and create_held_settlement,
-- the only writer of this shape, never sets the column.
--
-- No `revoke update (consumed_by_inv_id)` beside it, unlike 20260811000001.
-- That revoke is harmless there because the two writers are SECURITY DEFINER;
-- renew_term_deposit_with_merge is SECURITY INVOKER — it runs AS the caller — so
-- taking the privilege away from `authenticated` would take the merge with it.
-- The trigger is the whole guard here, which is what it is in practice there
-- too (the stack re-grants table privileges after migrations run).
create or replace function public.enforce_held_consumption_written_by_rpc()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.held_for_merge
     and new.consumed_by_inv_id is not null
     and (tg_op = 'INSERT' or old.consumed_by_inv_id is distinct from new.consumed_by_inv_id)
     and auth.uid() is not null
     and coalesce(current_setting('app.held_merge', true), '') <> '1' then
    raise exception 'held settlement: parked cash is folded in by renew_term_deposit_with_merge, not by writing the marker — if that function was recreated, it must keep set_config(''app.held_merge'', ''1'', true) around the stamp (#617)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_held_consumption_written_by_rpc() from public, anon, authenticated;

drop trigger if exists investment_transactions_held_consumption_rpc_only on public.investment_transactions;
-- `of consumed_by_inv_id`, not every update: naming the column is the only way to
-- change it, so a narrower trigger cannot be dodged — the lesson that made the
-- OTHER held triggers fire on every update does not apply to a single-column rule.
create trigger investment_transactions_held_consumption_rpc_only
  before insert or update of consumed_by_inv_id on public.investment_transactions
  for each row
  execute function public.enforce_held_consumption_written_by_rpc();
