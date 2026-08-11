-- The promise kept: a matured book folded into the successor it was handed to
-- (#638, Phase 3). Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_a uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_b public.investment_transactions;
  v_saving uuid := gen_random_uuid();
  v_new public.investment_transactions;
  v_ids uuid[];
  v_successor uuid;
  v_linked uuid;
  v_closed bigint;
  v_received bigint := 12500000;
  v_count int;
  v_stamped int;
  v_principals bigint[];
begin
  insert into auth.users (id, email) values (v_user, 'merge-successor@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Merge') returning goal_id into v_goal;

  -- Book A: two tranches, matured 3 days ago, locked well before that.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days, notes
  ) values (
    v_a, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date - 3, 8000000, 4, v_a, 30, 'PVcomBank A'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_a2, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date - 3, 4000000, 4.2, v_a
  );

  -- A recurring saving still points at A; it must end on B.
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (v_saving, v_user, v_goal, 'Monthly', 1000000, v_a);

  -- ── A spent tranche is not the caller's to name ──────────────────────────
  -- The book as the user sees it drops a tranche once its principal is gone, so
  -- demanding its id would make such a book unmergeable however often they
  -- reloaded. v_a3 is fully withdrawn and deliberately left out of v_ids.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_a3, v_user, v_goal, 'bank', 'investment',
    current_date - 150, current_date - 3, 1000000, 4, v_a
  );
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_a3,
    current_date - 20, 1000000, 1000000, true
  );

  -- The handover A -> B, arranged while A was closing in on maturity.
  select * into v_b from public.open_successor_book(
    v_a, 2000000, 4.5, current_date - 5, current_date + 300, 30, null,
    v_saving, to_char(current_date - 5, 'YYYY-MM'), null);

  v_ids := array[v_a, v_a2];
  v_principals := array[8000000::bigint, 4000000::bigint];

  -- ── A book that is not yet due is not merged early ───────────────────────
  update public.investment_transactions set expiry_date = current_date + 5
   where deposit_group_id = v_a;
  set constraints all immediate;
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals);
    raise exception 'merging a book before its maturity must be refused';
  exception when sqlstate '23514' then null;
  end;
  update public.investment_transactions set expiry_date = current_date - 3
   where deposit_group_id = v_a;
  set constraints all immediate;

  -- ── A tranche the caller never saw aborts the whole thing ────────────────
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, array[v_a], array[8000000::bigint]);
    raise exception 'a book that changed since load must be refused';
  exception when others then null;
  end;

  -- ── Nothing arrives from nowhere ─────────────────────────────────────────
  begin
    perform public.merge_book_into_successor(v_a, 0, 4.5, current_date, v_ids, v_principals);
    raise exception 'a merge of nothing must be refused';
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.merge_book_into_successor(v_a, 999000000000, 4.5, current_date, v_ids, v_principals);
    raise exception 'a received amount unmoored from the book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A balance that moved since the screen loaded is a changed book ───────
  -- The ids are all still there; only what they hold has changed, which is
  -- exactly the case ids alone cannot see.
  begin
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date, v_ids, array[7000000::bigint, 4000000::bigint]);
    raise exception 'a tranche whose balance moved must be refused';
  exception when others then null;
  end;

  -- ── The merge itself ─────────────────────────────────────────────────────
  select * into v_new from public.merge_book_into_successor(
    v_a, v_received, 4.6, current_date, v_ids, v_principals);

  -- Exactly one tranche lands in B, holding the cash that was actually received.
  if v_new.deposit_group_id is distinct from v_b.transaction_id then
    raise exception 'the merged tranche must join the successor book';
  end if;
  if v_new.amount_vnd <> v_received then
    raise exception 'the merged tranche must hold the received cash, found %', v_new.amount_vnd;
  end if;
  if v_new.interest_rate <> 4.6 then
    raise exception 'the merged tranche takes the entered rate';
  end if;
  if v_new.expiry_date is distinct from v_b.expiry_date then
    raise exception 'the merged tranche matures with its new book';
  end if;
  select count(*) into v_count from public.investment_transactions
   where deposit_group_id = v_b.transaction_id and transaction_type = 'investment';
  if v_count <> 2 then  -- B's own anchor + this one
    raise exception 'the merge must add exactly one tranche, found %', v_count;
  end if;

  -- Every tranche of A is closed to the last đồng.
  select sum(t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'), 0))
    into v_closed
    from public.investment_transactions t
   where t.deposit_group_id = v_a and t.transaction_type = 'investment';
  if v_closed <> 0 then
    raise exception 'the source book must be fully closed, % left', v_closed;
  end if;

  -- The cash is allocated across the source history without drift, and every
  -- withdrawal says where it went.
  select count(*), coalesce(sum(amount_vnd), 0) into v_stamped, v_closed
    from public.investment_transactions
   where transaction_type = 'withdrawal'
     and consumed_by_inv_id = v_new.transaction_id;
  if v_stamped <> 2 then
    raise exception 'each closed tranche must be stamped, found %', v_stamped;
  end if;
  if v_closed <> v_received then
    raise exception 'the allocated cash must equal what was received, found %', v_closed;
  end if;

  -- The promise has been kept, so it stops standing.
  select successor_deposit_tx_id into v_successor
    from public.investment_transactions where transaction_id = v_a;
  if v_successor is not null then
    raise exception 'a kept promise must not still stand';
  end if;

  -- And nothing is left funding the closed book.
  select linked_deposit_tx_id into v_linked
    from public.recurring_savings where saving_id = v_saving;
  if v_linked is distinct from v_b.transaction_id then
    raise exception 'the recurring link must end on the successor, found %', v_linked;
  end if;

  -- ── Once kept, it cannot be kept again ───────────────────────────────────
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.6, current_date, v_ids, v_principals);
    raise exception 'a book with no successor must not be merged';
  exception when others then null;
  end;

  -- ── The cash cannot be unpicked from B while it sits there ───────────────
  begin
    delete from public.investment_transactions
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a consumed withdrawal must not be deletable';
  exception when others then null;
  end;

  raise notice 'merge successor book: OK';
end;
$$;

rollback;
