-- Finishing a goal liquidates every live holding and archives it at 100% (#650).
-- Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_fund uuid;
  v_deposit uuid := gen_random_uuid();
  v_gold uuid := gen_random_uuid();
  v_book uuid := gen_random_uuid();
  v_book2 uuid := gen_random_uuid();
  v_book3 uuid := gen_random_uuid();
  v_result jsonb;
  v_goal_row public.savings_goals;
  v_live bigint;
  v_tx_count int;
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal@test.invalid');
  insert into public.savings_goals (user_id, goal_name, target_amount)
    values (v_user, 'New kitchen', 100000000) returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'VESAF', 'VESAF', 'equity', 20000) returning id into v_fund;

  -- A plain term deposit, gold, a fund bucket, and an accumulating book with two
  -- tranches: one of every shape the holdings tab can show.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    v_deposit, v_user, v_goal, 'bank', 'investment',
    current_date - 100, current_date + 265, 10000000, 5, 'ACB 12 tháng'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, amount_vnd, units, unit_price
  ) values (
    v_gold, v_user, v_goal, 'gold', 'investment',
    current_date - 300, 8000000, 2, 4000000
  );
  insert into public.investment_transactions (
    user_id, goal_id, fund_id, asset_type, transaction_type,
    investment_date, amount_vnd, units, unit_price
  ) values (
    v_user, v_goal, v_fund, 'fund', 'investment',
    current_date - 200, 5000000, 250, 20000
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 90, current_date + 275, 3000000, 4, v_book, 'Tích luỹ VCB'
  );
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_user, v_goal, 'bank', 'investment',
    current_date - 30, current_date + 275, 2000000, 4, v_book
  );

  -- ── A plan that leaves a holding out is refused ───────────────────────────
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000)
    ), current_date, 26000000);
    raise exception 'a plan missing a live holding must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A plan naming a holding the goal does not hold is refused ─────────────
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
      jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
      jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
      jsonb_build_object('key', 'book:' || v_book, 'received', 5100000),
      jsonb_build_object('key', 'tx:' || gen_random_uuid(), 'received', 1)
    ), current_date, 26000000);
    raise exception 'a plan naming an unheld holding must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Nothing above may have half-landed.
  select count(*) into v_tx_count from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal';
  if v_tx_count <> 0 then raise exception 'a refused finish must write no withdrawals'; end if;
  select completed_at into v_goal_row.completed_at from public.savings_goals where goal_id = v_goal;
  if v_goal_row.completed_at is not null then raise exception 'a refused finish must leave the goal active'; end if;

  -- ── Blockers name what still feeds the goal ───────────────────────────────
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd)
    values (v_user, v_goal, 'Gửi góp hàng tháng', 2000000);
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
      jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
      jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
      jsonb_build_object('key', 'book:' || v_book, 'received', 5100000)
    ), current_date, 26000000);
    raise exception 'a goal a recurring saving still feeds must not be finishable';
  exception when sqlstate '23514' then null;
  end;
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'recurring_saving' and label = 'Gửi góp hàng tháng') then
    raise exception 'the recurring saving must be named as a blocker';
  end if;
  delete from public.recurring_savings where user_id = v_user;

  update public.funds set dca_goal_id = v_goal where id = v_fund;
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'dca_plan' and label = 'VESAF') then
    raise exception 'the DCA plan must be named as a blocker';
  end if;
  update public.funds set dca_goal_id = null where id = v_fund;

  -- An ENDED recurring saving blocks too: the dashboard keeps synthesizing its
  -- realized months into the goal's value forever, and no withdrawal can remove
  -- them (there is no transaction to withdraw).
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, effective_to)
    values (v_user, v_goal, 'Đã dừng', 1000000, current_date - 1);
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'recurring_saving' and label = 'Đã dừng') then
    raise exception 'an ended recurring saving must still block the finish';
  end if;
  delete from public.recurring_savings where user_id = v_user;

  -- ── A holding that realizes nothing is refused, not half-written ─────────
  --
  -- investment_transactions requires amount_vnd > 0, so a zero would be rejected
  -- three statements later and roll the whole finish back behind a generic error.
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 0),
      jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
      jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
      jsonb_build_object('key', 'book:' || v_book, 'received', 5100000)
    ), current_date, 26000000);
    raise exception 'a zero realization must be refused';
  exception when sqlstate '23514' then null;
  end;
  select count(*) into v_tx_count from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal';
  if v_tx_count <> 0 then raise exception 'a refused zero must write no withdrawals'; end if;

  -- ── The finish itself ─────────────────────────────────────────────────────
  select public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
    jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
    jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
    jsonb_build_object('key', 'book:' || v_book, 'received', 5100000)
  ), current_date, 30000000) into v_result;

  if (v_result->>'realized')::bigint <> 30000000 then
    raise exception 'the realized total must be the cash the user recorded, got %', v_result->>'realized';
  end if;
  if (v_result->>'holdings')::int <> 4 then
    raise exception 'every holding must be liquidated, got %', v_result->>'holdings';
  end if;

  select * into v_goal_row from public.savings_goals where goal_id = v_goal;
  if v_goal_row.completed_at is null then raise exception 'the goal must be archived'; end if;
  if v_goal_row.completion_percentage <> 100 then raise exception 'a successful finish archives at 100%%'; end if;
  if v_goal_row.completion_value <> 30000000 then raise exception 'the completion value must be the snapshot passed in'; end if;

  -- Every holding is now empty: deposit and book principal fully withdrawn, all
  -- gold chỉ and all fund units sold.
  select coalesce(sum(t.amount_vnd), 0) - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.user_id = v_user and w.transaction_type = 'withdrawal'
         and w.parent_transaction_id is not null), 0)
    into v_live
    from public.investment_transactions t
   where t.user_id = v_user and t.transaction_type = 'investment' and t.fund_id is null;
  if v_live <> 0 then raise exception 'every non-fund holding must be emptied, % left', v_live; end if;

  if (select coalesce(sum(units), 0) from public.investment_transactions
       where user_id = v_user and fund_id = v_fund and transaction_type = 'investment')
     <> (select coalesce(sum(units_withdrawn), 0) from public.investment_transactions
          where user_id = v_user and fund_id = v_fund and transaction_type = 'withdrawal') then
    raise exception 'the whole fund bucket must be sold';
  end if;

  -- The book is settled, not merely zeroed — nothing may top it up again.
  if exists (select 1 from public.investment_transactions
              where deposit_group_id = v_book) then
    raise exception 'a fully closed book must not stay a live book';
  end if;

  -- History keeps its goal, and the withdrawals hold the progress steady.
  if exists (select 1 from public.investment_transactions
              where user_id = v_user and goal_id is distinct from v_goal) then
    raise exception 'finishing must not unlink a single transaction from the goal';
  end if;
  if exists (select 1 from public.investment_transactions
              where user_id = v_user and transaction_type = 'withdrawal' and affects_progress) then
    raise exception 'a finish withdrawal must not lower the progress it completes';
  end if;

  -- ── An archive takes no new money ─────────────────────────────────────────
  --
  -- The pickers hide a completed goal, but a stale tab or a direct API client
  -- can still name one. Hiding is presentation; this is the invariant.
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd
    ) values (v_user, v_goal, 'stock', 'investment', current_date, 1000000);
    raise exception 'a completed goal must not take a new holding';
  exception when sqlstate '23514' then null;
  end;
  begin
    insert into public.recurring_savings (user_id, goal_id, name, amount_vnd)
      values (v_user, v_goal, 'Gửi góp mới', 1000000);
    raise exception 'a completed goal must not take a new recurring saving';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.funds set dca_goal_id = v_goal where id = v_fund;
    raise exception 'a completed goal must not take a DCA plan';
  exception when sqlstate '23514' then null;
  end;

  -- Its PAST is not frozen, only its future: history stays editable.
  update public.investment_transactions set notes = 'ACB 12 tháng (đã tất toán)'
   where transaction_id = v_deposit;

  -- ── A finished goal is not finishable twice ───────────────────────────────
  begin
    perform public.finish_savings_goal(v_goal, '[]'::jsonb, current_date, 1);
    raise exception 'a completed goal must not be finished again';
  exception when sqlstate '23514' then null;
  end;

  -- ── Reopening restores it without touching history ────────────────────────
  select count(*) into v_tx_count from public.investment_transactions where user_id = v_user;
  perform public.reopen_savings_goal(v_goal);
  select * into v_goal_row from public.savings_goals where goal_id = v_goal;
  if v_goal_row.completed_at is not null or v_goal_row.completion_value is not null
     or v_goal_row.completion_percentage is not null then
    raise exception 'reopening must clear the whole snapshot';
  end if;
  if (select count(*) from public.investment_transactions where user_id = v_user) <> v_tx_count then
    raise exception 'reopening must not create or remove a transaction';
  end if;
  begin
    perform public.reopen_savings_goal(v_goal);
    raise exception 'an active goal has nothing to reopen';
  exception when sqlstate 'P0002' then null;
  end;

  -- ── Two accumulating books close in ONE finish ────────────────────────────
  --
  -- withdraw_accumulating_book used to build a temp table that lives until
  -- COMMIT, so the second call in a transaction died on "relation already
  -- exists" — which is every goal holding two books.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book2, v_user, v_goal, 'bank', 'investment',
    current_date - 40, current_date + 300, 4000000, 4, v_book2, 'Tích luỹ TCB'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book3, v_user, v_goal, 'bank', 'investment',
    current_date - 40, current_date + 300, 6000000, 4, v_book3, 'Tích luỹ MB'
  );
  select public.finish_savings_goal(v_goal, (
    select jsonb_agg(jsonb_build_object('key', 'book:' || t.transaction_id, 'received', t.amount_vnd))
      from public.investment_transactions t
     where t.user_id = v_user and t.deposit_group_id = t.transaction_id
  ), current_date, 10000000) into v_result;
  if (v_result->>'holdings')::int <> 2 then
    raise exception 'both books must close in one finish, got %', v_result->>'holdings';
  end if;

  raise notice 'finish_savings_goal: all assertions passed';
end $$;

-- ── A held-for-merge settlement and a promised successor each block ──────────
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_deposit uuid := gen_random_uuid();
  v_book uuid := gen_random_uuid();
  v_successor public.investment_transactions;
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal-blockers@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Blocked') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    v_deposit, v_user, v_goal, 'bank', 'investment',
    current_date - 10, current_date + 355, 5000000, 5, 'Sổ nguồn'
  );

  -- Cash parked for a merge has no source row left to liquidate.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, held_for_merge,
    merge_target_goal_id, notes
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_deposit,
    current_date, 5100000, 5000000, true, v_goal, 'Chờ gộp'
  );
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal) where code = 'held_settlement') then
    raise exception 'parked merge cash must block the finish';
  end if;
  delete from public.investment_transactions where user_id = v_user and held_for_merge;

  -- A book promised to a successor cannot be dissolved at all.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 20, 10000000, 4, v_book, 30, 'Sổ đã hứa'
  );
  select * into v_successor from public.open_successor_book(
    v_book, 1000000, 4.2, current_date - 5, current_date + 360, 30, null, null, null, null);
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'successor_handover' and label = 'Sổ đã hứa') then
    raise exception 'a promised handover must be named as a blocker';
  end if;

  raise notice 'finish_savings_goal blockers: all assertions passed';
end $$;

rollback;
