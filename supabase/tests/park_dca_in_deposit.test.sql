-- A month's fund DCA can be parked in a term deposit instead (20261002000002).
--
-- When deposit rates are high, the user puts this month's DCA for a fund into a
-- new term deposit, to move into the fund at maturity. On the plan that is one
-- decision with three effects, which must land together:
--
--   • the deposit exists, in the DCA's goal, filed under this month's plan, its
--     target fund the DCA's fund;
--   • the DCA line stops asking to buy — the pending seed goes, and a skip
--     row stops the next load re-seeding it;
--   • the skip says where the money went (parked_in_tx_id), so the line reads
--     "parked in Sổ VCB → E1VFVN30" instead of a bare "skipped".
--
-- Undoing it is deleting the deposit: the skip goes with it (FK cascade), and
-- the next load seeds the DCA again. Deleting the skip alone is refused — the
-- DCA would come back beside a deposit already counted for the month.
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
  v_oplan   uuid;
  v_fund    uuid;  -- DCA fund feeding v_goal
  v_bought  uuid;  -- DCA fund whose buy this month is already recorded
  v_plain   uuid;  -- not a DCA fund
  v_ofund   uuid;
  v_dep     uuid;
  v_dep2    uuid;
  v_row     public.investment_transactions;
  v_count   int;
  v_failed  boolean;
  v_state   text;
begin
  insert into auth.users (id, email) values (v_user, 'park-dca@test.invalid');
  insert into auth.users (id, email) values (v_other, 'park-dca-other@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Wealth Max') returning goal_id into v_goal;
  insert into public.monthly_plans (user_id, month, year, salary_vnd)
    values (v_user, extract(month from v_today)::int, extract(year from v_today)::int, 30000000) returning id into v_plan;
  insert into public.monthly_plans (user_id, month, year, salary_vnd)
    values (v_other, 1, 2026, 30000000) returning id into v_oplan;

  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
    values (v_user, 'VFMVN30 ETF', 'E1VFVN30', 'etf', 25000, true, 5000000, v_goal) returning id into v_fund;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
    values (v_user, 'DCDS', 'DCDS', 'equity', 90000, true, 2000000, v_goal) returning id into v_bought;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'Plain', 'PLN', 'equity', 10000) returning id into v_plain;
  insert into public.funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_other, 'Theirs', 'THR', 'equity', 10000, true, 1000000) returning id into v_ofund;

  perform public.seed_and_sync_plan_dca(v_plan);
  -- The DCDS buy is recorded for the month.
  update public.investment_transactions set units = 22.2, unit_price = 90000
   where plan_id = v_plan and fund_id = v_bought;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) park: deposit, no pending seed, a skip that names the deposit ──────
  v_dep := public.park_dca_in_deposit(
    p_plan_id => v_plan, p_fund_id => v_fund, p_amount_vnd => 5000000,
    p_interest_rate => 6.5, p_investment_date => v_today, p_expiry_date => v_today + 182,
    p_bank_code => null, p_notes => 'Sổ VCB 6 th.');

  select * into v_row from public.investment_transactions where transaction_id = v_dep;
  if v_row.asset_type <> 'bank' or v_row.transaction_type <> 'investment'
     or v_row.plan_id is distinct from v_plan or v_row.goal_id is distinct from v_goal
     or v_row.target_fund_id is distinct from v_fund
     or v_row.amount_vnd <> 5000000 or v_row.interest_rate <> 6.5 or v_row.expiry_date <> v_today + 182 then
    raise exception 'the parked deposit must be this month''s, in the DCA''s goal, its target the DCA fund; got plan % goal % target % amount %',
      v_row.plan_id, v_row.goal_id, v_row.target_fund_id, v_row.amount_vnd;
  end if;

  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id = v_fund and asset_type = 'fund';
  if v_count <> 0 then raise exception 'the pending DCA seed must go when the DCA is parked'; end if;

  select count(*) into v_count from public.plan_dca_skips
   where plan_id = v_plan and fund_id = v_fund and parked_in_tx_id = v_dep;
  if v_count <> 1 then raise exception 'the skip must name the deposit the DCA was parked in'; end if;

  -- The next load does not ask to buy it again.
  perform public.seed_and_sync_plan_dca(v_plan);
  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id = v_fund and asset_type = 'fund';
  if v_count <> 0 then raise exception 'a parked DCA must not be re-seeded'; end if;

  -- ── 2) the pair cannot be pulled apart ────────────────────────────────────
  v_failed := false;
  begin
    delete from public.plan_dca_skips where plan_id = v_plan and fund_id = v_fund;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'un-skipping a parked DCA alone must be refused — the DCA would come back beside the deposit';
  end if;

  v_failed := false;
  begin
    update public.plan_dca_skips set parked_in_tx_id = null where plan_id = v_plan and fund_id = v_fund;
    get diagnostics v_count = row_count;
    -- No update policy on the table: RLS makes the update a no-op, which is
    -- also a refusal. A row that changed is the failure.
    if v_count = 0 then v_failed := true; end if;
  exception when check_violation or insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'the link must not be rewritten by hand'; end if;

  -- Undo = delete the deposit: the skip goes, the DCA is seeded again.
  delete from public.investment_transactions where transaction_id = v_dep;
  select count(*) into v_count from public.plan_dca_skips where plan_id = v_plan and fund_id = v_fund;
  if v_count <> 0 then raise exception 'deleting the deposit must take its skip with it'; end if;
  perform public.seed_and_sync_plan_dca(v_plan);
  select count(*) into v_count from public.investment_transactions
   where plan_id = v_plan and fund_id = v_fund and asset_type = 'fund' and units is null;
  if v_count <> 1 then raise exception 'after the deposit is deleted the DCA line must be asked for again'; end if;

  -- ── 3) a fund already skipped can still be parked ─────────────────────────
  insert into public.plan_dca_skips (plan_id, fund_id) values (v_plan, v_fund);
  v_dep2 := public.park_dca_in_deposit(v_plan, v_fund, 5000000, 6.5, v_today, v_today + 91, null, null);
  select count(*) into v_count from public.plan_dca_skips
   where plan_id = v_plan and fund_id = v_fund and parked_in_tx_id = v_dep2;
  if v_count <> 1 then raise exception 'parking a skipped DCA must turn the plain skip into a parked one'; end if;

  -- ── 4) what cannot be parked ─────────────────────────────────────────────
  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_fund, 5000000, 6.5, v_today, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a DCA already parked this month must not be parked twice'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_bought, 2000000, 6.5, v_today, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a DCA already bought this month must not be parked too'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_plain, 2000000, 6.5, v_today, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'only a DCA fund has a DCA to park'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_fund, 0, 6.5, v_today, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a non-positive amount must be refused'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_fund, 5000000, 6.5, v_today, v_today, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a term deposit must mature after it is opened'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_fund, 5000000, null, v_today, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a term deposit needs a rate'; end if;

  v_failed := false;
  begin
    perform public.park_dca_in_deposit(v_plan, v_fund, 5000000, 6.5, v_today + 1, v_today + 182, null, null);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a deposit opened in the future must be refused'; end if;

  -- ── 5) ownership ──────────────────────────────────────────────────────────
  v_state := null;
  begin
    perform public.park_dca_in_deposit(v_plan, v_ofund, 1000000, 6.5, v_today, v_today + 182, null, null);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'someone else''s fund must be refused as insufficient_privilege, got %', v_state;
  end if;

  v_state := null;
  begin
    perform public.park_dca_in_deposit(v_oplan, v_fund, 1000000, 6.5, v_today, v_today + 182, null, null);
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from 'P0002' then
    raise exception 'someone else''s plan must read as not found, got %', v_state;
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- A skip cannot name another user's transaction, even written directly.
  v_failed := false;
  begin
    insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd)
      values (v_other, 'bank', 'investment', v_today, 1000000) returning transaction_id into v_dep;
    perform set_config('app.park_dca_write', '1', true);
    insert into public.plan_dca_skips (plan_id, fund_id, parked_in_tx_id) values (v_plan, v_bought, v_dep);
  exception when check_violation then v_failed := true;
  end;
  perform set_config('app.park_dca_write', '', true);
  if not v_failed then raise exception 'a skip naming another user''s deposit must be refused'; end if;

  raise notice 'park_dca_in_deposit: all assertions passed';
end;
$$;

rollback;
