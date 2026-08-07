-- Move the displayed name with the money when a renewal changes bank (#640).
--
-- A structured deposit stores its bank's NAME in `notes` (the deposit form posts
-- `notes: selectedBankName`), and that is the name every holdings list shows —
-- goal detail derives a row's name from `notes` before any fallback. The renewal
-- moved `bank_code` alone, so a deposit re-deposited from PVcomBank to
-- Vietcombank kept reading "PVcomBank" everywhere: the feature that lets the user
-- move banks would have shipped showing the wrong bank afterwards.
--
-- The rename is deliberately narrow. It fires only when the row's current notes
-- EQUAL the name of the bank it is leaving — i.e. the label is bank-derived, the
-- form having written it. A name the user typed ("Sổ cưới") is theirs and
-- survives the move untouched, as does a legacy deposit with no bank_code to
-- compare against. The closed-cycle snapshot is inserted from `v_old`, so history
-- keeps the bank the money was actually held at.
--
-- Body is otherwise identical to 20260620000006. A separate forward migration
-- (not an edit) so databases that already recorded that one still converge; the
-- signature is unchanged, so create-or-replace needs no DROP.

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
    update public.investment_transactions
       set consumed_by_inv_id = p_tx_id, updated_at = now()
     where transaction_id = v_hid;
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
         -- Relabel only a bank-DERIVED name: the notes must still read exactly as
         -- the bank being left. Anything the user typed is left alone.
         notes           = case
           when p_bank_code is not null
            and p_bank_code is distinct from v_old.bank_code
            and v_old.bank_code is not null
            and v_old.notes = (select b.name from public.banks b where b.code = v_old.bank_code)
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
