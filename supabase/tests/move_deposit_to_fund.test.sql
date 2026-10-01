-- A matured term deposit moves into its target fund, inside its goal
-- (20261001000001).
--
-- What has to hold for the goal's value not to jump:
--
--   • the deposit is closed in full and the fund is bought with exactly the
--     money the bank paid out, in the same goal, in one transaction;
--   • the pair cannot be pulled apart — deleting the withdrawal alone would
--     bring the deposit back while the purchase stays (the money counted
--     twice), so it is refused, and deleting the purchase takes the withdrawal
--     with it (the deposit comes back whole);
--   • the link between them is written by the function only.
--
-- Everything that matters is exercised AS THE USER (role authenticated, with a
-- JWT subject): a guard that reads auth.uid(), or a function relying on RLS for
-- ownership, proves nothing when run as the superuser.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user     uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_today    date := public.business_today();
  v_goal     uuid;
  v_fund     uuid;
  v_ofund    uuid;  -- another user's fund
  v_dep      uuid;  -- matured 100,000,000 term deposit, the happy path
  v_dep2     uuid;  -- matured, used for the undo-by-deleting-the-purchase case
  v_young    uuid;  -- matures in 30 days
  v_flex     uuid;  -- no rate, no maturity
  v_book     uuid;  -- accumulating book anchor
  v_pledged  uuid;
  v_odep     uuid;  -- another user's deposit
  v_renew    uuid;  -- carries a target fund through a renewal
  v_saving   uuid;
  v_res      jsonb;
  v_wd       uuid;
  v_buy      uuid;
  v_row      public.investment_transactions;
  v_wrow     public.investment_transactions;
  v_count    int;
  v_text     text;
  v_failed   boolean;
  v_state    text;
begin
  insert into auth.users (id, email) values (v_user, 'move-to-fund@test.invalid');
  insert into auth.users (id, email) values (v_other, 'move-to-fund-other@test.invalid');

  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Wealth Max') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'VFMVN30 ETF', 'E1VFVN30', 'etf', 25000) returning id into v_fund;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_other, 'Their fund', 'THEIRS', 'equity', 10000) returning id into v_ofund;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, target_fund_id)
  values (v_user, v_goal, 'bank', 'investment', v_today - 192, 100000000, 6, v_today - 10, v_fund)
  returning transaction_id into v_dep;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', v_today - 100, 20000000, 6, v_today - 1)
  returning transaction_id into v_dep2;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', v_today - 60, 10000000, 6, v_today + 30)
  returning transaction_id into v_young;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', v_today - 60, 10000000)
  returning transaction_id into v_flex;

  v_book := gen_random_uuid();
  insert into public.investment_transactions
    (transaction_id, user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, deposit_group_id)
  values (v_book, v_user, v_goal, 'bank', 'investment', v_today - 200, 10000000, 6, v_today - 5, v_book);

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, is_pledged)
  values (v_user, v_goal, 'bank', 'investment', v_today - 200, 10000000, 6, v_today - 5, true)
  returning transaction_id into v_pledged;

  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_other, 'bank', 'investment', v_today - 200, 10000000, 6, v_today - 5)
  returning transaction_id into v_odep;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, target_fund_id)
  values (v_user, v_goal, 'bank', 'investment', v_today - 92, 30000000, 6, v_today, v_fund)
  returning transaction_id into v_renew;

  -- A recurring saving feeding the happy-path deposit: the move closes it, so
  -- the link must go, as it does for any closing withdrawal.
  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, effective_from, linked_deposit_tx_id)
  values (v_user, 'Monthly park', v_goal, 5000000, v_today - 300, v_dep)
  returning saving_id into v_saving;

  -- ── the user, from here on ────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) the move: closed in full, bought with the payout, same goal ────────
  v_res := public.move_deposit_to_fund(v_dep, 103000000, v_fund, 4120, 25000, v_today);
  v_wd  := (v_res ->> 'withdrawal_id')::uuid;
  v_buy := (v_res ->> 'purchase_id')::uuid;

  select * into v_row from public.investment_transactions where transaction_id = v_buy;
  if v_row.transaction_type <> 'investment' or v_row.asset_type <> 'fund' or v_row.fund_id <> v_fund then
    raise exception 'the purchase must be a fund investment in the target fund, got % % %', v_row.transaction_type, v_row.asset_type, v_row.fund_id;
  end if;
  if v_row.goal_id is distinct from v_goal then
    raise exception 'the purchase must stay in the deposit''s goal, got %', v_row.goal_id;
  end if;
  if v_row.amount_vnd <> 103000000 or v_row.units <> 4120 or v_row.unit_price <> 25000 or v_row.investment_date <> v_today then
    raise exception 'the purchase must be the payout at the given units/NAV/date, got % % % %', v_row.amount_vnd, v_row.units, v_row.unit_price, v_row.investment_date;
  end if;
  if not v_row.units_estimated then
    raise exception 'units priced at the app''s NAV must be flagged as estimated';
  end if;

  select * into v_wrow from public.investment_transactions where transaction_id = v_wd;
  if v_wrow.transaction_type <> 'withdrawal' or v_wrow.parent_transaction_id <> v_dep or v_wrow.goal_id is distinct from v_goal then
    raise exception 'the withdrawal must close the deposit in its goal';
  end if;
  if v_wrow.principal_withdrawn <> 100000000 then
    raise exception 'the whole principal must be closed, got %', v_wrow.principal_withdrawn;
  end if;
  -- Money out of the deposit = money into the fund.
  if v_wrow.amount_vnd <> v_row.amount_vnd then
    raise exception 'received (%) and invested (%) must be the same money', v_wrow.amount_vnd, v_row.amount_vnd;
  end if;
  if not v_wrow.affects_progress then
    raise exception 'the closing withdrawal counts against progress — the purchase is what restores it';
  end if;
  if v_wrow.moved_to_fund_tx_id is distinct from v_buy then
    raise exception 'the withdrawal must name the purchase it paid for';
  end if;

  -- The ledger readers see the new columns.
  select count(*) into v_count from public.active_investment_transactions
   where transaction_id in (v_wd, v_buy) and (moved_to_fund_tx_id = v_buy or units_estimated);
  if v_count <> 2 then
    raise exception 'active_investment_transactions must carry moved_to_fund_tx_id and units_estimated, matched % row(s)', v_count;
  end if;
  select count(*) into v_count from public.active_investment_transactions
   where transaction_id = v_renew and target_fund_id = v_fund;
  if v_count <> 1 then
    raise exception 'active_investment_transactions must carry target_fund_id';
  end if;

  -- The recurring saving no longer points at a closed deposit.
  select coalesce(linked_deposit_tx_id::text, 'null') || '/' || coalesce(unlinked_reason, 'null')
    into v_text from public.recurring_savings where saving_id = v_saving;
  if v_text <> 'null/closed' then
    raise exception 'the saving linked to a moved deposit must be unlinked as closed, got %', v_text;
  end if;

  -- ── 2) a deposit moves once ───────────────────────────────────────────────
  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_dep, 103000000, v_fund, 4120, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a closed deposit must not move twice'; end if;

  -- ── 3) the pair cannot be pulled apart ────────────────────────────────────
  v_failed := false;
  begin
    delete from public.investment_transactions where transaction_id = v_wd;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'deleting the withdrawal alone must be refused — the deposit would return beside the purchase';
  end if;

  v_failed := false;
  begin
    update public.investment_transactions set moved_to_fund_tx_id = null where transaction_id = v_wd;
  exception when check_violation or insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'the link must not be cleared by hand'; end if;

  -- A link written by hand pairs rows that never shared money.
  v_failed := false;
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, parent_transaction_id, investment_date, amount_vnd, principal_withdrawn, moved_to_fund_tx_id)
    values (v_user, v_goal, 'bank', 'withdrawal', v_dep2, v_today, 1000, 1000, v_buy);
  exception when check_violation or insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'writing moved_to_fund_tx_id outside move_deposit_to_fund must be refused'; end if;

  -- Undo = delete the purchase: the withdrawal goes with it, the deposit is whole.
  v_res := public.move_deposit_to_fund(v_dep2, 20300000, v_fund, 812, 25000, v_today);
  delete from public.investment_transactions where transaction_id = (v_res ->> 'purchase_id')::uuid;
  select count(*) into v_count from public.investment_transactions
   where transaction_id = (v_res ->> 'withdrawal_id')::uuid;
  if v_count <> 0 then
    raise exception 'deleting the purchase must delete the withdrawal that paid for it';
  end if;
  select count(*) into v_count from public.investment_transactions
   where parent_transaction_id = v_dep2 and transaction_type = 'withdrawal';
  if v_count <> 0 then
    raise exception 'after undoing the move the deposit must have no withdrawal left';
  end if;

  -- ── 4) what cannot be moved ───────────────────────────────────────────────
  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_young, 10000000, v_fund, 400, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a deposit that has not matured must not move'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_dep2, 20300000, v_fund, 812, 25000, v_today + 1);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a move dated in the future must be refused'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_flex, 10000000, v_fund, 400, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a deposit with no term must not move'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_book, 10000000, v_fund, 400, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'an accumulating book must not move through this path'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_pledged, 10000000, v_fund, 400, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a pledged deposit must not move'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_dep2, 300000000, v_fund, 12000, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a payout of more than ten times the deposit must be refused'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_fund(v_dep2, 20300000, v_fund, 0, 25000, v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a purchase with no units must be refused'; end if;

  -- ── 5) ownership ──────────────────────────────────────────────────────────
  v_state := null;
  begin
    perform public.move_deposit_to_fund(v_dep2, 20300000, v_ofund, 812, 25000, v_today);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'buying someone else''s fund must be refused as insufficient_privilege, got %', v_state;
  end if;

  v_state := null;
  begin
    perform public.move_deposit_to_fund(v_odep, 10000000, v_fund, 400, 25000, v_today);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'someone else''s deposit must read as not found, got %', v_state;
  end if;

  -- ── 6) target_fund_id belongs on a single term deposit, and to its owner ──
  v_failed := false;
  begin
    update public.investment_transactions set target_fund_id = v_ofund where transaction_id = v_young;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a target fund belonging to another user must be refused'; end if;

  v_failed := false;
  begin
    update public.investment_transactions set target_fund_id = v_fund where transaction_id = v_book;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a book tranche must not take a target fund'; end if;

  v_failed := false;
  begin
    update public.investment_transactions set target_fund_id = v_fund where transaction_id = v_buy;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a fund purchase must not take a target fund'; end if;

  update public.investment_transactions set target_fund_id = v_fund where transaction_id = v_young;
  update public.investment_transactions set target_fund_id = null where transaction_id = v_young;

  -- A renewal rolls the live row forward in place: the target goes with it.
  perform public.renew_term_deposit(v_renew, 30450000, 6.5, v_today + 182, v_today, 450000);
  select count(*) into v_count from public.investment_transactions
   where transaction_id = v_renew and target_fund_id = v_fund and amount_vnd = 30450000;
  if v_count <> 1 then
    raise exception 'a renewed deposit must keep its target fund';
  end if;

  -- ── 7) units_estimated belongs on a priced fund purchase ──────────────────
  v_failed := false;
  begin
    update public.investment_transactions set units_estimated = true where transaction_id = v_young;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a deposit cannot have estimated units'; end if;

  v_failed := false;
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, fund_id, investment_date, amount_vnd, units_estimated)
    values (v_user, v_goal, 'fund', 'investment', v_fund, v_today, 1000000, true);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'an unpriced purchase cannot have estimated units'; end if;

  -- Correcting the purchase is the user's to do.
  update public.investment_transactions set units = 4100, unit_price = 25122, units_estimated = false where transaction_id = v_buy;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ── 8) the renew-or-move threshold ────────────────────────────────────────
  insert into public.user_settings (user_id) values (v_user);
  select count(*) into v_count from public.user_settings where user_id = v_user and renew_min_rate_pct is null;
  if v_count <> 1 then raise exception 'an unchosen threshold must read as NULL'; end if;

  update public.user_settings set renew_min_rate_pct = 8 where user_id = v_user;

  v_failed := false;
  begin
    update public.user_settings set renew_min_rate_pct = 101 where user_id = v_user;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a threshold above 100%% must be refused'; end if;

  v_failed := false;
  begin
    update public.user_settings set renew_min_rate_pct = -1 where user_id = v_user;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a negative threshold must be refused'; end if;

  raise notice 'move_deposit_to_fund: all assertions passed';
end;
$$;

rollback;
