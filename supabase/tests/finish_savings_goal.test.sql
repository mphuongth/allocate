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
  v_other_fund uuid;
  v_other_goal uuid;
  v_result jsonb;
  v_fp text;
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
    ), current_date, 26000000, public.savings_goal_ledger_fingerprint(v_goal));
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
    ), current_date, 26000000, public.savings_goal_ledger_fingerprint(v_goal));
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
    ), current_date, 26000000, public.savings_goal_ledger_fingerprint(v_goal));
    raise exception 'a goal a recurring saving still feeds must not be finishable';
  exception when sqlstate '23514' then null;
  end;
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'recurring_saving' and label = 'Gửi góp hàng tháng') then
    raise exception 'the recurring saving must be named as a blocker';
  end if;
  delete from public.recurring_savings where user_id = v_user;

  -- A LIVE plan: pointed, switched on, with an amount — what seeding requires.
  update public.funds set dca_goal_id = v_goal, is_dca = true, dca_monthly_amount_vnd = 1000000
   where id = v_fund;
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'dca_plan' and label = 'VESAF') then
    raise exception 'the DCA plan must be named as a blocker';
  end if;
  update public.funds set dca_goal_id = null, is_dca = false, dca_monthly_amount_vnd = null
   where id = v_fund;

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

  -- ── A saving that feeds this goal's BOOK blocks, whatever goal it is under ─
  --
  -- Nothing makes recurring_savings.goal_id agree with the goal of the deposit
  -- it is linked to, and the full close clears every recurring link targeting
  -- the book it settles — so without this the finish would silently end a plan
  -- belonging to another goal.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Mục tiêu khác')
    returning goal_id into v_other_goal;
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_user, v_other_goal, 'Gửi góp vào sổ chung', 1000000, v_book);
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'recurring_saving' and label = 'Gửi góp vào sổ chung') then
    raise exception 'a saving linked to this goal''s book must block the finish';
  end if;
  delete from public.recurring_savings where user_id = v_user;

  -- A single term deposit breaks differently but just as quietly: the link
  -- SURVIVES the liquidation and then points at an empty deposit that has
  -- dropped out of the maturity flow, so the saving can never be folded into
  -- the deposit it was promised to while still reading as linked.
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_user, v_other_goal, 'Gộp vào sổ kỳ hạn', 1000000, v_deposit);
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'recurring_saving' and label = 'Gộp vào sổ kỳ hạn') then
    raise exception 'a saving linked to this goal''s term deposit must block the finish';
  end if;
  delete from public.recurring_savings where user_id = v_user;
  delete from public.savings_goals where goal_id = v_other_goal;

  -- ── A contribution dated in the FUTURE blocks, and is refused ────────────
  --
  -- POST /api/v1/investment-transactions allows a future date when the row
  -- carries a plan_id — that is how next month's planned deposit is recorded —
  -- and it is a live holding from the moment it is written. Liquidating it would
  -- date the withdrawal before the purchase it draws on.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    gen_random_uuid(), v_user, v_goal, 'bank', 'investment',
    current_date + 7, current_date + 372, 1000000, 5, 'Kế hoạch tháng sau'
  );
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal)
                  where code = 'future_holding' and label = 'Kế hoạch tháng sau') then
    raise exception 'a future-dated contribution must be named as a blocker';
  end if;
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000)
    ), current_date, 26000000, public.savings_goal_ledger_fingerprint(v_goal));
    raise exception 'a goal holding a future contribution must not be finishable';
  exception when sqlstate '23514' then null;
  end;
  delete from public.investment_transactions
   where user_id = v_user and notes = 'Kế hoạch tháng sau';

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
    ), current_date, 26000000, public.savings_goal_ledger_fingerprint(v_goal));
    raise exception 'a zero realization must be refused';
  exception when sqlstate '23514' then null;
  end;
  select count(*) into v_tx_count from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal';
  if v_tx_count <> 0 then raise exception 'a refused zero must write no withdrawals'; end if;

  -- ── The fingerprint tracks VALUE, not a client-writable timestamp ─────────
  --
  -- updated_at is an ordinary column a PostgREST client can leave alone while
  -- changing the money; the row count does not move on an edit at all.
  v_fp := public.savings_goal_ledger_fingerprint(v_goal);
  update public.investment_transactions set amount_vnd = amount_vnd + 1
   where transaction_id = v_deposit;
  if public.savings_goal_ledger_fingerprint(v_goal) = v_fp then
    raise exception 'the fingerprint must notice an amount changed without updated_at';
  end if;
  update public.investment_transactions set amount_vnd = amount_vnd - 1
   where transaction_id = v_deposit;
  if public.savings_goal_ledger_fingerprint(v_goal) <> v_fp then
    raise exception 'the fingerprint must return to itself once the edit is undone';
  end if;

  -- ── A stale valuation is refused, not archived ────────────────────────────
  --
  -- The completion value is computed by the caller before the RPC takes the
  -- goal's lock. A fingerprint read on the way in proves the ledger it was
  -- computed against is still the one being liquidated.
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
      jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
      jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
      jsonb_build_object('key', 'book:' || v_book, 'received', 5100000)
    ), current_date, 30000000, 'not-the-ledger-you-valued');
    raise exception 'a finish carrying a stale valuation must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A payout too small to spread over a book is refused up front ──────────
  --
  -- The two-tranche book paid 1 đồng rounds one tranche's cash share to zero,
  -- and amount_vnd > 0 would refuse that row half way through the finish.
  begin
    perform public.finish_savings_goal(v_goal, jsonb_build_array(
      jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
      jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
      jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
      jsonb_build_object('key', 'book:' || v_book, 'received', 1)
    ), current_date, 30000000, public.savings_goal_ledger_fingerprint(v_goal));
    raise exception 'a payout that cannot reach every tranche must be refused';
  exception when sqlstate '23514' then null;
  end;
  select count(*) into v_tx_count from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal';
  if v_tx_count <> 0 then raise exception 'a refused book payout must write no withdrawals'; end if;

  -- ── The finish itself ─────────────────────────────────────────────────────
  select public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_deposit, 'received', 10400000),
    jsonb_build_object('key', 'tx:' || v_gold, 'received', 9000000),
    jsonb_build_object('key', 'fund:' || v_fund, 'received', 5500000),
    jsonb_build_object('key', 'book:' || v_book, 'received', 5100000)
  ), current_date, 30000000, public.savings_goal_ledger_fingerprint(v_goal)) into v_result;

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
  -- The withdrawals are ORDINARY: the archived 100% comes from the snapshot, not
  -- from propping the bar up. Written affects_progress = false they would go on
  -- propping it after a REOPEN — snapshot cleared, balance zero, and the goal
  -- back on the active list still reading its pre-finish progress.
  if exists (select 1 from public.investment_transactions
              where user_id = v_user and transaction_type = 'withdrawal'
                and not affects_progress) then
    raise exception 'a finish withdrawal must count against progress once reopened';
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
    -- A LIVE plan — the guard and the blocker ask the same question, so what
    -- would have stopped the finish is what is refused afterwards. (Parking a
    -- switched-off fund on an archived goal is allowed and harmless; switching it
    -- on is what the recheck refuses, asserted in its own block below.)
    update public.funds set dca_goal_id = v_goal, is_dca = true, dca_monthly_amount_vnd = 1000000
     where id = v_fund;
    raise exception 'a completed goal must not take a DCA plan';
  exception when sqlstate '23514' then null;
  end;

  -- Its LEDGER is settled too. Deleting a liquidation withdrawal would bring the
  -- original deposit back to life at full value under a goal still at 100%.
  begin
    delete from public.investment_transactions
     where user_id = v_user and transaction_type = 'withdrawal' and parent_transaction_id = v_deposit;
    raise exception 'a completed goal must not give up its liquidation withdrawals';
  exception when sqlstate '23514' then null;
  end;
  -- ...and neither may the original holding simply grow again, which never
  -- touches goal_id and so is invisible to the reference guard.
  begin
    update public.investment_transactions set amount_vnd = amount_vnd + 1000000
     where transaction_id = v_deposit;
    raise exception 'a completed goal must not have its holdings topped up';
  exception when sqlstate '23514' then null;
  end;

  -- ...nor may a settled holding be moved OUT of the archive. A fund bucket is
  -- keyed by (goal, fund), so unassigning the purchase while its sell stays with
  -- the archived goal makes the whole position reappear under Unallocated.
  begin
    update public.investment_transactions set goal_id = null
     where user_id = v_user and fund_id = v_fund and transaction_type = 'investment';
    raise exception 'a completed goal must not give up its holdings';
  exception when sqlstate '23514' then null;
  end;

  -- ...nor may a settled fund purchase be re-pointed at a DIFFERENT fund. The
  -- bucket is keyed by (goal, fund), so the sell that emptied it would stay in
  -- the old fund's bucket while the purchase stands up as a live position in the
  -- new one — no amount changed, so only identity gives it away.
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'DCDS', 'DCDS', 'equity', 30000) returning id into v_other_fund;
  begin
    update public.investment_transactions set fund_id = v_other_fund
     where user_id = v_user and fund_id = v_fund and transaction_type = 'investment';
    raise exception 'a settled fund purchase must not change fund';
  exception when sqlstate '23514' then null;
  end;

  -- Frozen means the MONEY. A completed goal is still history to read and tidy.
  update public.investment_transactions set notes = 'ACB 12 tháng (đã tất toán)'
   where transaction_id = v_deposit;

  -- ── The snapshot may not be archived against a ledger that moved ──────────
  if public.savings_goal_ledger_fingerprint(v_goal) is null then
    raise exception 'the ledger fingerprint must be readable';
  end if;

  -- ── A finished goal is not finishable twice ───────────────────────────────
  begin
    perform public.finish_savings_goal(v_goal, '[]'::jsonb, current_date, 1, public.savings_goal_ledger_fingerprint(v_goal));
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
  ), current_date, 10000000, public.savings_goal_ledger_fingerprint(v_goal)) into v_result;
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
  v_before text;
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

  -- ── The fingerprint sees a withdrawal that draws on the goal by PARENT ────
  --
  -- A bank/gold withdrawal is keyed by its parent, not by a goal, and the sell
  -- sheet legitimately posts goal_id = NULL from the unallocated context. It
  -- still lowers the very holding a finish is about to liquidate, so a
  -- fingerprint that only counted goal_id matches would call the ledger
  -- unchanged and archive the pre-withdrawal value.
  v_before := public.savings_goal_ledger_fingerprint(v_goal);
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (
    v_user, null, 'bank', 'withdrawal', v_deposit,
    current_date, 1000000, 1000000
  );
  if public.savings_goal_ledger_fingerprint(v_goal) = v_before then
    raise exception 'the fingerprint must notice a withdrawal parented to the goal''s holding';
  end if;
  delete from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal' and goal_id is null;

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

-- ── A withdrawal that belongs to the goal only through its PARENT ────────────
--
-- The sell sheet posts goal_id = NULL from the unallocated context, and that row
-- still draws on the goal's deposit — check_withdrawal_balance measures it
-- against the parent, and so does the valuation. After the finish it is as
-- settled as any other: deleting it would hand the deposit back the principal it
-- had taken (the finish only closed what was left) and stand it up as a live
-- holding under an archived goal.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_deposit uuid := gen_random_uuid();
  v_early uuid := gen_random_uuid();
  v_live bigint;
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal-parent-wd@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Parent-keyed') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    v_deposit, v_user, v_goal, 'bank', 'investment',
    current_date - 100, current_date + 265, 10000000, 5, 'Sổ ACB'
  );
  -- Written before the finish, from a surface that had no goal in hand.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (
    v_early, v_user, null, 'bank', 'withdrawal', v_deposit,
    current_date - 10, 1020000, 1000000
  );

  perform public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_deposit, 'received', 9200000)
  ), current_date, 10200000, public.savings_goal_ledger_fingerprint(v_goal));

  select t.amount_vnd - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'), 0)
    into v_live
    from public.investment_transactions t where t.transaction_id = v_deposit;
  if v_live <> 0 then raise exception 'the finish must close the remaining balance, % left', v_live; end if;

  begin
    delete from public.investment_transactions where transaction_id = v_early;
    raise exception 'a withdrawal that drew on the archived goal must not be deletable';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.investment_transactions set principal_withdrawn = 500000
     where transaction_id = v_early;
    raise exception 'a withdrawal that drew on the archived goal must not be re-priced';
  exception when sqlstate '23514' then null;
  end;

  -- Reopening is the way out, and then it behaves like any other row.
  perform public.reopen_savings_goal(v_goal);
  delete from public.investment_transactions where transaction_id = v_early;

  raise notice 'finish_savings_goal parent-keyed withdrawals: all assertions passed';
end $$;

-- ── The completion snapshot is written by the finish, not by a client ────────
--
-- The savings_goals UPDATE policy is row-scoped, not column-scoped, so without a
-- guard a signed-in client could stamp a goal completed at any figure it liked
-- while the holdings stayed live — and the freeze triggers would then lock that
-- fiction in place.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_deposit uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal-snapshot@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Fabricated') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, amount_vnd, interest_rate
  ) values (
    v_deposit, v_user, v_goal, 'bank', 'investment', current_date - 5, 5000000, 5
  );

  -- Speak as that signed-in user: auth.uid() resolves, so the guard applies.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  begin
    update public.savings_goals
       set completed_at = now(), completion_value = 999000000, completion_percentage = 100
     where goal_id = v_goal;
    raise exception 'a client must not be able to stamp the completion snapshot';
  exception when sqlstate '23514' then null;
  end;

  -- ...nor by creating a goal that claims to be finished already.
  begin
    insert into public.savings_goals (user_id, goal_name, completed_at, completion_value, completion_percentage)
      values (v_user, 'Born finished', now(), 999000000, 100);
    raise exception 'a goal must not be created already completed';
  exception when sqlstate '23514' then null;
  end;

  -- Editing the goal's ordinary fields is untouched by the guard.
  update public.savings_goals set goal_name = 'Fabricated (renamed)' where goal_id = v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'An ordinary new goal');

  -- The RPC is the way, and it liquidates as it goes.
  perform public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_deposit, 'received', 5100000)
  ), current_date, 5100000, public.savings_goal_ledger_fingerprint(v_goal));
  if (select completion_percentage from public.savings_goals where goal_id = v_goal) <> 100 then
    raise exception 'the RPC must still be able to write the snapshot';
  end if;

  -- And the privilege it takes does not outlive that statement.
  begin
    update public.savings_goals set completion_value = 1 where goal_id = v_goal;
    raise exception 'the completion-write flag must not survive the RPC';
  exception when sqlstate '23514' then null;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'finish_savings_goal snapshot guard: all assertions passed';
end $$;

-- ── A book shared between two goals is not closed by finishing one ──────────
--
-- withdraw_accumulating_book spreads its amount across EVERY live tranche. Given
-- only this goal's share it took the difference out of the other goal's tranche,
-- left part of this goal's own balance live, and archived at 100% anyway.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal_a uuid;
  v_goal_b uuid;
  v_book uuid := gen_random_uuid();
  v_tranche uuid := gen_random_uuid();
  v_left_b bigint;
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal-split-book@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'A') returning goal_id into v_goal_a;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'B') returning goal_id into v_goal_b;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book, v_user, v_goal_a, 'bank', 'investment',
    current_date - 90, current_date + 275, 3000000, 4, v_book, 'Tích luỹ chung'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_tranche, v_user, v_goal_a, 'bank', 'investment',
    current_date - 30, current_date + 275, 2000000, 4, v_book
  );
  -- The app moves a book as one group; a direct write can still split it.
  update public.investment_transactions set goal_id = v_goal_b where transaction_id = v_tranche;

  begin
    perform public.finish_savings_goal(v_goal_a, jsonb_build_array(
      jsonb_build_object('key', 'book:' || v_book, 'received', 3100000)
    ), current_date, 3100000, public.savings_goal_ledger_fingerprint(v_goal_a));
    raise exception 'a book shared with another goal must not be closed by this finish';
  exception when sqlstate '23514' then null;
  end;

  -- The other goal's tranche is untouched, and neither goal is archived.
  select t.amount_vnd - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'), 0)
    into v_left_b
    from public.investment_transactions t where t.transaction_id = v_tranche;
  if v_left_b <> 2000000 then
    raise exception 'the other goal''s tranche must be untouched, % left', v_left_b;
  end if;
  if exists (select 1 from public.savings_goals
              where user_id = v_user and completed_at is not null) then
    raise exception 'a refused finish must archive nothing';
  end if;

  -- Put the book back in one goal and it finishes normally.
  update public.investment_transactions set goal_id = v_goal_a where transaction_id = v_tranche;
  perform public.finish_savings_goal(v_goal_a, jsonb_build_array(
    jsonb_build_object('key', 'book:' || v_book, 'received', 5200000)
  ), current_date, 5200000, public.savings_goal_ledger_fingerprint(v_goal_a));
  if exists (select 1 from public.investment_transactions where deposit_group_id = v_book) then
    raise exception 'the whole book must close once it belongs to one goal';
  end if;

  raise notice 'finish_savings_goal split book: all assertions passed';
end $$;

-- ── A finished goal can still be deleted outright ───────────────────────────
--
-- Deleting a goal first clears merge_target_goal_id on its CONSUMED held
-- settlements: that reference has no foreign key, so the delete would leave it
-- dangling and the #525 ownership trigger would refuse the very update the
-- deletion depends on. Once a merge has consumed a settlement the target is dead
-- metadata (lib/heldForMerge skips the row), so the freeze must not read that
-- cleanup as a change of value — counting it made a finished goal undeletable,
-- and the route's ignored error surfaced it as a bare 404.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_dep uuid := gen_random_uuid();
  v_dest uuid := gen_random_uuid();
  v_held uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'finish-goal-consumed@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Merged') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, amount_vnd, interest_rate, notes
  ) values (v_dep, v_user, v_goal, 'bank', 'investment', current_date - 50, 5000000, 5, 'Sổ nguồn');
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, amount_vnd, interest_rate, notes
  ) values (v_dest, v_user, v_goal, 'bank', 'investment', current_date - 1, 5100000, 5, 'Sổ đích');
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, held_for_merge,
    merge_target_goal_id, consumed_by_inv_id, notes
  ) values (
    v_held, v_user, v_goal, 'bank', 'withdrawal', v_dep,
    current_date - 2, 5100000, 5000000, true, v_goal, v_dest, 'Đã gộp'
  );

  perform public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_dest, 'received', 5200000)
  ), current_date, 5200000, public.savings_goal_ledger_fingerprint(v_goal));

  -- Metadata-only, on a row that contributes nothing: allowed.
  update public.investment_transactions set merge_target_goal_id = null
   where transaction_id = v_held;

  -- ...while the settlement's MONEY is still settled.
  begin
    update public.investment_transactions set principal_withdrawn = 1
     where transaction_id = v_held;
    raise exception 'a consumed settlement must not be re-priced under an archive';
  exception when sqlstate '23514' then null;
  end;

  delete from public.savings_goals where goal_id = v_goal;
  if exists (select 1 from public.savings_goals where goal_id = v_goal) then
    raise exception 'a finished goal must still be deletable';
  end if;

  raise notice 'finish_savings_goal consumed-settlement cleanup: all assertions passed';
end $$;

-- ─── A fund sale is not a withdrawal from the tranche it names ───────────────
--
-- A withdrawal keyed by a fund draws on that (goal, fund) bucket and not on the
-- deposit it names as parent — the precedence check_withdrawal_balance applies
-- (#606), for a shape the POST route accepts and older rows carry.
-- savings_goal_live_holdings already excludes those rows, so the finish plan
-- carries the book's full principal; book_live_tranches did not, so the close
-- measured a smaller book and refused the plan as an overdraw. The two readers
-- have to agree, or the goal cannot be finished at all.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_fund uuid;
  v_book uuid := gen_random_uuid();
  v_total bigint;
  v_completed timestamptz;
begin
  insert into auth.users (id, email) values (v_user, 'finish-fundkey@test.invalid');
  insert into public.savings_goals (user_id, goal_name, target_amount)
    values (v_user, 'Quỹ và sổ', 10000000) returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'VESAF', 'FKB', 'equity', 50000) returning id into v_fund;

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, fund_id, units, unit_price
  ) values (v_user, v_goal, 'fund', 'investment', current_date - 30, 5000000, v_fund, 100, 50000);

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 60, current_date + 300, 4000000, 4, v_book, 'Tích luỹ'
  );

  -- The whole fund position, sold, naming the book's anchor as its parent.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, fund_id, units_withdrawn, principal_withdrawn, parent_transaction_id
  ) values (
    v_user, v_goal, 'fund', 'withdrawal', current_date,
    5500000, v_fund, 100, 5000000, v_book
  );

  select coalesce(sum(eff), 0) into v_total from public.book_live_tranches(v_book);
  if v_total <> 4000000 then
    raise exception 'a fund sale must not be charged to the book it names: read %', v_total;
  end if;

  -- And the finish itself goes through, which is what the user actually meets.
  perform public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'book:' || v_book, 'received', 4100000)
  ), current_date, 4100000, public.savings_goal_ledger_fingerprint(v_goal));

  select completed_at into v_completed from public.savings_goals where goal_id = v_goal;
  if v_completed is null then raise exception 'the goal must be finished'; end if;

  raise notice 'finish_savings_goal fund key: all assertions passed';
end $$;

-- ─── A DCA plan that is switched off is not feeding anything ────────────────
--
-- is_dca = false with dca_goal_id still set is a state the table allows and old
-- rows carry (disable_fund_dca, 20260722000002, clears both together — but only
-- from the day it landed). Seeding requires f.is_dca and an amount, so such a
-- fund puts nothing into the goal, while the blocker refused the finish forever
-- and named a fund whose DCA the user had already turned off.
--
-- Narrowing the blocker widens the guard: re-enabling a fund still pointed at a
-- goal that has since been finished would seed into an archive, and enabling
-- touches is_dca and the amount, not dca_goal_id.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_fund uuid;
  v_deposit uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'finish-dca-off@test.invalid');
  insert into public.savings_goals (user_id, goal_name, target_amount)
    values (v_user, 'DCA tắt', 10000000) returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'VESAF', 'DCF', 'equity', 50000) returning id into v_fund;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_deposit, v_user, v_goal, 'bank', 'investment', current_date - 30, current_date + 300, 4000000, 5);

  -- Pointed at the goal, switched off, no amount: it seeds nothing.
  update public.funds set dca_goal_id = v_goal, is_dca = false, dca_monthly_amount_vnd = null
   where id = v_fund;

  if exists (select 1 from public.savings_goal_finish_blockers(v_goal) where code = 'dca_plan') then
    raise exception 'a switched-off DCA plan must not block the finish';
  end if;

  -- ...and an ENABLED one still does, so the assertion above is not vacuous.
  update public.funds set is_dca = true, dca_monthly_amount_vnd = 1000000 where id = v_fund;
  if not exists (select 1 from public.savings_goal_finish_blockers(v_goal) where code = 'dca_plan') then
    raise exception 'a live DCA plan must still block the finish';
  end if;
  update public.funds set is_dca = false, dca_monthly_amount_vnd = null where id = v_fund;

  perform public.finish_savings_goal(v_goal, jsonb_build_array(
    jsonb_build_object('key', 'tx:' || v_deposit, 'received', 4100000)
  ), current_date, 4100000, public.savings_goal_ledger_fingerprint(v_goal));

  -- Switching it back on would put next month's money into an archive. The
  -- update names is_dca and the amount; dca_goal_id never changes.
  begin
    update public.funds set is_dca = true, dca_monthly_amount_vnd = 1000000 where id = v_fund;
    raise exception 'a DCA plan must not be switched on toward a finished goal';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'finish_savings_goal disabled DCA: all assertions passed';
end $$;

-- ═══ live holdings measure the bucket the way the invariant does (#668) ══════
--
-- savings_goal_live_holdings carries its own copy of 20260803000005's
-- parent-backed-claim derivation, and says why in its own comment: "copied from
-- 20260803000005 so the two cannot disagree". #668 put `p.user_id = wd.user_id`
-- into that function — a bucket counts only its own owner's purchases — and the
-- copy has to move with it, or the two disagree in the direction that archives a
-- goal it did not finish liquidating.
--
-- Probed before the fix: a goal holding 100 units, plus a legacy claim of 10 on a
-- cross-owner purchase carrying this goal, reported 90 live units. The finish
-- liquidated 90, and left the goal archived at 100% with ten units still in it —
-- a live holding inside a completed goal, which no screen shows.
do $$
declare
  v_a uuid; v_b uuid; v_g uuid; v_fund uuid; v_buy uuid; v_foreign uuid;
  v_units numeric; v_principal bigint; v_res jsonb; v_left numeric;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'fin-668a@test.invalid') returning id into v_a;
  insert into auth.users (id, email) values (gen_random_uuid(), 'fin-668b@test.invalid') returning id into v_b;
  insert into public.savings_goals (user_id, goal_name, target_amount)
  values (v_a, 'Cross-owner claim', 100000000) returning goal_id into v_g;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_a, 'Finish Fund', 'FINF', 'equity', 1000000) returning id into v_fund;

  -- Every deferred check in this transaction has to settle before the table can be
  -- altered — including any left pending by the blocks above, which is why this is
  -- ALL rather than the two this block writes against.
  set constraints all immediate;
  alter table public.investment_transactions disable trigger user;

  -- Everything this goal actually holds: A's own 100 units.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_a, v_g, v_fund, 'fund', 'investment', '2026-01-01', 100000000, 100, 1000000)
  returning transaction_id into v_buy;
  -- A legacy purchase owned by B carrying this goal and fund, and A's claim on it.
  -- enforce_fk_ownership refuses both now (#474 / #525).
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_b, v_g, v_fund, 'fund', 'investment', '2026-01-01', 50000000, 50, 1000000)
  returning transaction_id into v_foreign;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, units_withdrawn, principal_withdrawn)
  values (v_a, v_g, null, 'withdrawal', '2026-02-01', 10000000, v_foreign, 10, 10000000);

  alter table public.investment_transactions enable trigger user;
  set constraints all deferred;

  -- What the goal holds is what the invariant would let it sell: all 100 units.
  select principal, units into v_principal, v_units
    from public.savings_goal_live_holdings(v_g) where key = 'fund:' || v_fund;
  if v_units <> 100 or v_principal <> 100000000 then
    raise exception 'live holdings must count the bucket as the invariant does, got % units / %', v_units, v_principal;
  end if;

  select public.finish_savings_goal(v_g,
    jsonb_build_array(jsonb_build_object('key', 'fund:' || v_fund, 'received', 100000000)),
    current_date, 100000000, public.savings_goal_ledger_fingerprint(v_g)) into v_res;

  -- And an archived goal holds nothing. This is the assertion that matters: the
  -- finish is advertised as all-or-nothing, so a residue in a completed goal is a
  -- lie the UI has no way to show.
  select coalesce(sum(t.units), 0)
         - coalesce((select sum(w.units_withdrawn) from public.investment_transactions w
                      where w.user_id = v_a and w.transaction_type = 'withdrawal'
                        and w.asset_type = 'fund' and w.fund_id = v_fund), 0)
    into v_left
    from public.investment_transactions t
   where t.user_id = v_a and t.fund_id = v_fund and t.transaction_type = 'investment';
  if v_left <> 0 then
    raise exception 'an archived goal must hold nothing, % units left', v_left;
  end if;

  raise notice 'finish_savings_goal: live holdings mirror the bucket the invariant measures';
end $$;

rollback;
