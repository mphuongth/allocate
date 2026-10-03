-- Several of a month's fund DCAs can be parked in ONE term deposit
-- (20261003000002).
--
-- The user holds five DCA funds under Unallocated and opens one 5M deposit at
-- the bank instead of buying five funds. park_dca_in_deposit could only park
-- one line per deposit (a unique index on parked_in_tx_id), so the app needed
-- five deposits for one real one. park_dca_lines_in_deposit parks N lines in
-- one deposit:
--
--   • one deposit, this month's, in the lines' shared goal. Its target fund is
--     the fund when there is one line, and none when there are several — where
--     the money goes is the per-line shares below;
--   • every parked line stops asking to buy and has a skip naming the deposit,
--     carrying the share it put in (parked_amount_vnd = its DCA amount);
--   • undo is still deleting the deposit: every skip goes with it.
--
-- park_dca_in_deposit keeps working, and now records its share too.
--
-- Exercised AS THE USER (role authenticated + JWT subject).
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_today   date := public.business_today();
  v_goal    uuid;
  v_plan    uuid;
  v_f1      uuid;  -- Unallocated DCA funds
  v_f2      uuid;
  v_f3      uuid;
  v_f4      uuid;  -- Unallocated DCA fund left out of the park
  v_bought  uuid;  -- Unallocated DCA fund already bought this month
  v_goaled  uuid;  -- DCA fund under a goal
  v_ofund   uuid;
  v_dep     uuid;
  v_single  uuid;
  v_row     public.investment_transactions;
  v_count   int;
  v_sum     bigint;
  v_failed  boolean;
begin
  insert into auth.users (id, email) values (v_user, 'park-lines@test.invalid');
  insert into auth.users (id, email) values (v_other, 'park-lines-other@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Wealth Max') returning goal_id into v_goal;
  insert into public.monthly_plans (user_id, month, year, salary_vnd)
    values (v_user, extract(month from v_today)::int, extract(year from v_today)::int, 30000000) returning id into v_plan;

  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'F1', 'F1', 'equity', 10000, true, 1000000) returning id into v_f1;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'F2', 'F2', 'equity', 10000, true, 1500000) returning id into v_f2;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'F3', 'F3', 'equity', 10000, true, 2500000) returning id into v_f3;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'F4', 'F4', 'equity', 10000, true, 700000) returning id into v_f4;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'Bought', 'BGT', 'equity', 10000, true, 800000) returning id into v_bought;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
    values (v_user, 'Goaled', 'GLD', 'equity', 10000, true, 900000, v_goal) returning id into v_goaled;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_other, 'Theirs', 'THR', 'equity', 10000, true, 1000000) returning id into v_ofund;

  perform public.seed_and_sync_plan_dca(v_plan);
  update public.investment_transactions set units = 80, unit_price = 10000
   where plan_id = v_plan and fund_id = v_bought;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) three lines, one deposit ───────────────────────────────────────────
  v_dep := public.park_dca_lines_in_deposit(
    p_plan_id => v_plan, p_fund_ids => array[v_f1, v_f2, v_f3], p_amount_vnd => 5000000,
    p_interest_rate => 6.5, p_investment_date => v_today, p_expiry_date => v_today + 182,
    p_bank_code => null, p_notes => 'Sổ NCB 6 th.');

  select * into v_row from public.investment_transactions where transaction_id = v_dep;
  if v_row.asset_type <> 'bank' or v_row.plan_id is distinct from v_plan
     or v_row.goal_id is not null or v_row.amount_vnd <> 5000000 then
    raise exception 'one Unallocated deposit of this month expected; got plan % goal % amount %',
      v_row.plan_id, v_row.goal_id, v_row.amount_vnd;
  end if;
  if v_row.target_fund_id is not null then
    raise exception 'a deposit parking several lines has no single target fund, got %', v_row.target_fund_id;
  end if;

  select count(*), sum(parked_amount_vnd) into v_count, v_sum from public.plan_dca_skips
   where plan_id = v_plan and parked_in_tx_id = v_dep;
  if v_count <> 3 or v_sum <> 5000000 then
    raise exception 'three skips naming the deposit, shares summing to 5M expected; got % / %', v_count, v_sum;
  end if;
  if not exists (select 1 from public.plan_dca_skips
                  where plan_id = v_plan and fund_id = v_f2 and parked_amount_vnd = 1500000) then
    raise exception 'each skip carries its own DCA amount as its share';
  end if;

  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id in (v_f1, v_f2, v_f3) and asset_type = 'fund';
  if v_count <> 0 then raise exception 'the parked lines'' pending seeds must go'; end if;

  perform public.seed_and_sync_plan_dca(v_plan);
  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id in (v_f1, v_f2, v_f3) and asset_type = 'fund';
  if v_count <> 0 then raise exception 'parked lines must not be re-seeded'; end if;
  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id = v_f4 and asset_type = 'fund' and units is null;
  if v_count <> 1 then raise exception 'a line left out of the park keeps its pending seed'; end if;

  -- ── 2) refusals — none of them writes anything ────────────────────────────
  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[v_f4, v_goaled], 1600000, 6.5, v_today, v_today + 182);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'lines from different goals must not share a deposit'; end if;

  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[v_f4, v_bought], 1500000, 6.5, v_today, v_today + 182);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a line already bought this month must not be parked'; end if;

  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[v_f4, v_f1], 1700000, 6.5, v_today, v_today + 182);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a line already parked must not be parked again'; end if;

  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[v_f4, v_f4], 1400000, 6.5, v_today, v_today + 182);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a fund named twice must be refused'; end if;

  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[]::uuid[], 1000000, 6.5, v_today, v_today + 182);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'parking no lines must be refused'; end if;

  v_failed := false;
  begin
    perform public.park_dca_lines_in_deposit(v_plan, array[v_f4, v_ofund], 1700000, 6.5, v_today, v_today + 182);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'someone else''s fund must be refused'; end if;

  select count(*) into v_count from public.plan_dca_skips where plan_id = v_plan and fund_id = v_f4;
  if v_count <> 0 then raise exception 'a refused park must leave no skip behind'; end if;

  -- ── 3) one line through either function: target fund set, share recorded ─
  v_single := public.park_dca_in_deposit(
    p_plan_id => v_plan, p_fund_id => v_f4, p_amount_vnd => 700000,
    p_interest_rate => 6.5, p_investment_date => v_today, p_expiry_date => v_today + 91);
  select * into v_row from public.investment_transactions where transaction_id = v_single;
  if v_row.target_fund_id is distinct from v_f4 then
    raise exception 'a single parked line keeps its fund as the deposit''s target';
  end if;
  if not exists (select 1 from public.plan_dca_skips
                  where plan_id = v_plan and fund_id = v_f4 and parked_amount_vnd = 700000) then
    raise exception 'park_dca_in_deposit must record its share too';
  end if;

  -- ── 4) undo: deleting the deposit releases every line it parked ──────────
  delete from public.investment_transactions where transaction_id = v_dep;
  select count(*) into v_count from public.plan_dca_skips where plan_id = v_plan and fund_id in (v_f1, v_f2, v_f3);
  if v_count <> 0 then raise exception 'deleting the deposit must release all its lines, % skips left', v_count; end if;

  reset role;
  perform public.seed_and_sync_plan_dca(v_plan);
  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id in (v_f1, v_f2, v_f3) and asset_type = 'fund' and units is null;
  if v_count <> 3 then raise exception 'released lines must be seeded again, got %', v_count; end if;

  raise notice 'park_dca_lines_in_deposit.test.sql: OK';
end $$;

rollback;
