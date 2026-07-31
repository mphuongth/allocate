-- A held-for-merge settlement must be backed by a real deposit (#588).
--
-- The settlement's amount_vnd IS net worth: closing the source removes it from
-- total assets, and the pool synthesizes the parked cash straight back
-- (lib/heldForMerge → dashboard overview). The route used to build that row from
-- the client's body, so two things were possible against a live database:
--
--   • a held row with NO source at all — the withdrawal invariant (#587/#599)
--     refuses every other source-less withdrawal, but exempted this shape
--     because it had no source to name yet; and
--   • an amount far larger than the deposit it claimed to settle — the invariant
--     bounds principal_withdrawn, never the withdrawal's own amount_vnd.
--
-- create_held_settlement derives the owner, goal, asset type, direction and the
-- principal being closed from the SOURCE, under a row lock; the
-- investment_transactions_held_shape constraint stops the row being written any
-- other way.
--
-- Ownership across users is RLS's job (the function is security invoker, so a
-- foreign source is simply not visible). This file runs as the owner of every
-- fixture, and covers the checks that hold regardless of who is asking: the
-- row-to-row ones, the derivation, and the shape.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_other   uuid;
  v_goal    uuid;
  v_goal2   uuid;
  v_ogoal   uuid;
  v_src     uuid;  -- plain 1,000,000 bank deposit
  v_src2    uuid;  -- 2,000,000, used for the bound + anchor cases
  v_partial uuid;  -- 5,000,000 with 2,000,000 already withdrawn
  v_gold    uuid;
  v_book    uuid;
  v_pledged uuid;
  v_wd      uuid;
  v_oth_tx  uuid;
  v_free    uuid;  -- a deposit with no goal
  v_held    uuid;
  v_partial2 uuid;  -- the deposit whose settlement blocks its deletion
  v_row     public.investment_transactions;
  v_saving  uuid;
  v_link    uuid;
  v_count   bigint;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'held-src@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'held-other@test.invalid') returning id into v_other;

  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House')  returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car')    returning goal_id into v_goal2;
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Their') returning goal_id into v_ogoal;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1000000) returning transaction_id into v_src;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 2000000) returning transaction_id into v_src2;

  -- ── 1) the happy path derives, it does not copy ─────────────────────────────
  -- The caller says which deposit and how much came back. Everything else is
  -- read off the source — including principal_withdrawn, which is what the old
  -- path let the client choose.
  v_row := public.create_held_settlement(v_src, 1050000, '2026-07-01', null, v_src2);

  if v_row.principal_withdrawn <> 1000000 then
    raise exception 'must close the whole remaining principal, got %', v_row.principal_withdrawn;
  end if;
  if v_row.amount_vnd <> 1050000 then
    raise exception 'must record what was received, got %', v_row.amount_vnd;
  end if;
  if not v_row.held_for_merge or v_row.transaction_type <> 'withdrawal' or v_row.asset_type <> 'bank' then
    raise exception 'wrong shape: held=% type=% asset=%',
      v_row.held_for_merge, v_row.transaction_type, v_row.asset_type;
  end if;
  if v_row.parent_transaction_id is distinct from v_src then
    raise exception 'must parent to the deposit it closes, got %', v_row.parent_transaction_id;
  end if;
  -- No explicit target was given, so the cash stays where the deposit was.
  if v_row.merge_target_goal_id is distinct from v_goal then
    raise exception 'target must default to the source goal, got %', v_row.merge_target_goal_id;
  end if;
  if v_row.user_id is distinct from v_user then
    raise exception 'owner must come from the source, got %', v_row.user_id;
  end if;

  -- ── 2) one deposit, one settlement ──────────────────────────────────────────
  -- The FOR UPDATE is taken before the remaining-principal sum is read, so a
  -- second settlement can only ever see the first one's withdrawal.
  begin
    perform public.create_held_settlement(v_src, 1050000);
    raise exception 'a second settlement of the same deposit must be refused' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 3) the amount is bounded by the deposit ─────────────────────────────────
  -- The #588 inflation: a 2,000,000 deposit settled for 999,000,000, which the
  -- dashboard would have added to total assets in full.
  begin
    perform public.create_held_settlement(v_src2, 999000000);
    raise exception 'an amount unrelated to the source must be refused' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;
  -- Principal plus a plausible interest is not what the bound is aimed at.
  v_row := public.create_held_settlement(v_src2, 2200000, '2026-07-01');
  if v_row.principal_withdrawn <> 2000000 then
    raise exception 'a real settlement must still go through, got %', v_row.principal_withdrawn;
  end if;

  -- ── 4) only a plain, active, single bank deposit ────────────────────────────
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 3000000, 3, 1000000) returning transaction_id into v_gold;
  begin
    perform public.create_held_settlement(v_gold, 100000);
    raise exception 'gold is not settled for merge' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- An accumulating book anchor self-groups (deposit_group_id = its own id). One
  -- row cannot close a book that spans tranches.
  v_book := gen_random_uuid();
  insert into public.investment_transactions (transaction_id, user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, deposit_group_id)
  values (v_book, v_user, v_goal, 'bank', 'investment', '2026-01-01', 4000000, v_book);
  begin
    perform public.create_held_settlement(v_book, 100000);
    raise exception 'an accumulating book is not settled for merge' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, is_pledged)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 4000000, true) returning transaction_id into v_pledged;
  begin
    perform public.create_held_settlement(v_pledged, 100000);
    raise exception 'a pledged deposit is frozen as collateral' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- A withdrawal has nothing left to close.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 500000, v_pledged, 500000) returning transaction_id into v_wd;
  begin
    perform public.create_held_settlement(v_wd, 100000);
    raise exception 'a withdrawal is not a source' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  begin
    perform public.create_held_settlement(gen_random_uuid(), 100000);
    raise exception 'a source that does not exist must be refused' using errcode = 'ZZ999';
  exception when no_data_found then null;
  end;

  -- ── 5) where the cash is earmarked ──────────────────────────────────────────
  -- merge_target_goal_id has no FK (it is an app-managed mirror), so a foreign
  -- goal would otherwise be written and the parked cash stranded in it.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 1000000) returning transaction_id into v_partial;
  begin
    perform public.create_held_settlement(v_partial, 1000000, '2026-07-01', v_ogoal);
    raise exception 'another user''s goal must be refused as the target' using errcode = 'ZZ999';
  -- insufficient_privilege, not check_violation: the route turns this into the
  -- 403 every other cross-user reference answers with (#474).
  exception when insufficient_privilege then null;
  end;
  -- Nor the caller's own OTHER goal. Two readers use two different columns —
  -- the dashboard displays by merge_target_goal_id, renew_term_deposit_with_merge
  -- consumes by goal_id — so a settlement earmarked elsewhere would show in one
  -- goal and be consumable only from another. A settlement does not move cash
  -- between goals.
  begin
    perform public.create_held_settlement(v_partial, 1000000, '2026-07-01', v_goal2);
    raise exception 'a target other than the deposit''s own goal must be refused' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;
  -- Naming the deposit's own goal explicitly is the normal client call.
  v_row := public.create_held_settlement(v_partial, 1000000, '2026-07-01', v_goal);
  if v_row.merge_target_goal_id is distinct from v_goal or v_row.goal_id is distinct from v_goal then
    raise exception 'both goal columns must be the source goal, got goal_id=% target=%',
      v_row.goal_id, v_row.merge_target_goal_id;
  end if;

  -- A deposit with NO goal is the one case where the target decides — there is
  -- nothing for it to disagree with — and the row then takes it as its own
  -- goal_id so both readers still agree.
  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, 'bank', 'investment', '2026-02-15', 1000000) returning transaction_id into v_free;
  v_row := public.create_held_settlement(v_free, 1000000, '2026-07-01', v_goal2);
  if v_row.goal_id is distinct from v_goal2 or v_row.merge_target_goal_id is distinct from v_goal2 then
    raise exception 'an unallocated deposit must take the target as its goal, got goal_id=% target=%',
      v_row.goal_id, v_row.merge_target_goal_id;
  end if;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_other, v_ogoal, 'bank', 'investment', '2026-01-01', 1000000) returning transaction_id into v_oth_tx;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-01', 1000000) returning transaction_id into v_partial;
  begin
    perform public.create_held_settlement(v_partial, 1000000, '2026-07-01', null, v_oth_tx);
    raise exception 'another user''s deposit must be refused as the anchor' using errcode = 'ZZ999';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_held_settlement(v_partial, 1000000, '2026-07-01', null, v_partial);
    raise exception 'a deposit cannot wait to be merged into itself' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 6) a partly withdrawn deposit closes only what is left ──────────────────
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-01', 5000000) returning transaction_id into v_partial;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-05-01', 2000000, v_partial, 2000000);

  v_row := public.create_held_settlement(v_partial, 3100000, '2026-07-01');
  if v_row.principal_withdrawn <> 3000000 then
    raise exception 'must close only the 3,000,000 left, got %', v_row.principal_withdrawn;
  end if;

  -- ── 7) the recurring unlink still rides along (#531) ────────────────────────
  -- The RPC inserts the same shape the trigger watches, so the link clears inside
  -- the same transaction — no second statement, nothing to half-succeed.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-06-01', 1000000) returning transaction_id into v_partial;
  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_user, 'Monthly transfer', v_goal, 500000, v_partial) returning saving_id into v_saving;

  perform public.create_held_settlement(v_partial, 1000000, '2026-07-01');

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then
    raise exception 'settling the source must clear linked_deposit_tx_id, still %', v_link;
  end if;

  -- ── 8) the shape constraint, for every other writer ─────────────────────────
  -- These are the raw inserts the route used to make. The RPC is the only path
  -- that should build this row, and the constraint is what makes that true of a
  -- service-role script or a future endpoint too.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       principal_withdrawn, units_withdrawn, affects_progress, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 999000000, 0, 0, true, true, v_goal);
    raise exception 'a held row with no source must be refused' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, held_for_merge)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 1000000, v_src2, 0, true);
    raise exception 'a held row with no target goal must be refused' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'investment', '2026-07-01', 1000000, v_src2, true, v_goal);
    raise exception 'a held INVESTMENT is not a settlement' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- Everything about this row is legal except that its two goal columns disagree,
  -- so only the constraint's goal clause can be what refuses it. A fresh deposit,
  -- and the principal it really has left, keeps some other rule from refusing it
  -- first and making this case pass for the wrong reason.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-06-20', 1000000) returning transaction_id into v_partial;
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, affects_progress, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 1000000, v_partial, 1000000, true, true, v_goal2);
    raise exception 'the two goal columns must agree' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 9) the amount bound, for every writer ───────────────────────────────────
  -- Routing the route through the RPC is not the same as making the RPC the only
  -- writer: an authenticated caller reaches this table directly, and their own
  -- rows are exactly what this is about. A shape-only constraint lets both of
  -- these through, and each one puts a number the deposit cannot back straight
  -- into total assets.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-06-15', 1000000) returning transaction_id into v_partial;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, affects_progress, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 999000000, v_partial, 1000000, true, true, v_goal);
    raise exception 'a raw held INSERT must still be bounded by its source' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- Created properly, then inflated by an UPDATE that touches nothing else.
  v_row := public.create_held_settlement(v_partial, 1050000, '2026-07-01');
  v_held := v_row.transaction_id;
  v_partial2 := v_partial;  -- the deposit this settlement is parked against
  begin
    update public.investment_transactions set amount_vnd = 999000000 where transaction_id = v_held;
    raise exception 'a held row must stay bounded after it exists' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- The bound excludes the row itself, so an ordinary edit within it is fine.
  update public.investment_transactions set amount_vnd = 1060000 where transaction_id = v_held;
  select amount_vnd into v_count from public.investment_transactions where transaction_id = v_held;
  if v_count <> 1060000 then
    raise exception 'a legitimate amount edit must go through, got %', v_count;
  end if;

  -- Bounding the amount is not enough on its own. Taking a token principal keeps
  -- the deposit alive in net worth while the pool adds the settlement beside it,
  -- so the same money is counted twice — 999,999 still in the deposit AND up to
  -- ten million in the pool. A held settlement closes the deposit outright.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-06-25', 1000000) returning transaction_id into v_partial;
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, affects_progress, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 10000000, v_partial, 1, true, true, v_goal);
    raise exception 'a held row must close the whole deposit, not a token slice' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 10) NULL is not a way around the goal agreement ─────────────────────────
  -- A CHECK passes on UNKNOWN, so plain equality would let an UPDATE blank
  -- goal_id: the dashboard keeps displaying the cash under the non-null target
  -- while the merge refuses it for a goal that no longer matches.
  begin
    update public.investment_transactions set goal_id = null where transaction_id = v_held;
    raise exception 'blanking goal_id must not slip past the goal agreement' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 11) deleting the deposit a settlement is parked against ─────────────────
  -- parent_transaction_id is ON DELETE SET NULL, so this delete would null the
  -- settlement's only link back to what it closed — the unbacked row this whole
  -- migration forbids. It is refused, with the prefix the route turns into a 409
  -- rather than the 500 a bare constraint violation would have produced.
  --
  -- Catching check_violation alone would not prove anything: WITHOUT the guard
  -- the FK's SET NULL trips the shape constraint, which is also a check_violation
  -- — and is precisely the bare 23514 the route cannot translate. So the message
  -- has to be ours.
  begin
    delete from public.investment_transactions where transaction_id = v_partial2;
    raise exception 'deleting a settled deposit must be refused while its settlement stands' using errcode = 'ZZ999';
  exception when check_violation then
    if sqlerrm not like 'held settlement:%' then
      raise exception 'the refusal must be the guard, not a bare constraint violation the route reports as 500: %', sqlerrm;
    end if;
  end;
  -- Removing the settlement first ("Bỏ chờ gộp") frees the deposit, which is the
  -- remedy the message names.
  delete from public.investment_transactions where parent_transaction_id = v_partial2;
  delete from public.investment_transactions where transaction_id = v_partial2;
  select count(*) into v_count from public.investment_transactions where transaction_id = v_partial2;
  if v_count <> 0 then
    raise exception 'the deposit must delete once its settlement is gone';
  end if;

  -- Dropping the flag must not be a way to keep an otherwise-illegal row either:
  -- an ordinary withdrawal still answers to the withdrawal invariant.
  select count(*) into v_count
  from public.investment_transactions
  where user_id = v_user and held_for_merge and parent_transaction_id is null;
  if v_count <> 0 then
    raise exception 'no held row may exist without a source, found %', v_count;
  end if;

  raise notice 'held_settlement_source_backed.test.sql: OK';
end $$;

rollback;
