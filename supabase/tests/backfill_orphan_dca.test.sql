-- Regression for the one-time orphan backfill in
-- 20260723000002_backfill_orphan_pending_dca.sql (#472 follow-up).
--
-- The backfill must remove ONLY pending seeded DCA fund rows detached from their
-- plan (plan_id NULL, is_dca_seeded, units NULL) and leave everything else:
-- a still-planned pending row, a recorded (detached) buy, and a manual fund tx.
--
-- Runs against the local stack inside a rolled-back transaction; a failed
-- assertion RAISEs and, under `psql -v ON_ERROR_STOP=1`, exits non-zero.
-- Run via `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_fund uuid;
  v_plan uuid;
  v_orphan uuid;      -- pending seeded, plan gone (plan_id NULL) → must be deleted
  v_planned uuid;     -- pending seeded, still has a plan          → survives
  v_recorded uuid;    -- seeded but recorded (units set), detached → survives
  v_manual uuid;      -- manual fund tx (not seeded)               → survives
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'backfill@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_user, 'Fund', 'BKF', 'equity', 20000) returning id into v_fund;
  insert into public.monthly_plans (user_id, month, year, salary_vnd) values (v_user, 11, 2099, 50000000) returning id into v_plan;

  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, is_dca_seeded, units, plan_id)
    values (v_user, v_fund, 'fund', 'investment', '2099-11-01', 2000000, true, null, null) returning transaction_id into v_orphan;
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, is_dca_seeded, units, plan_id)
    values (v_user, v_fund, 'fund', 'investment', '2099-11-01', 2000000, true, null, v_plan) returning transaction_id into v_planned;
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, is_dca_seeded, units, unit_price, plan_id)
    values (v_user, v_fund, 'fund', 'investment', '2099-11-01', 2000000, true, 100, 20000, null) returning transaction_id into v_recorded;
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, is_dca_seeded, units, plan_id)
    values (v_user, v_fund, 'fund', 'investment', '2099-11-01', 3000000, false, null, null) returning transaction_id into v_manual;

  -- The backfill statement, verbatim.
  delete from public.investment_transactions
   where plan_id is null
     and asset_type = 'fund'
     and is_dca_seeded
     and units is null;

  if exists (select 1 from public.investment_transactions where transaction_id = v_orphan) then
    raise exception 'orphaned pending seeded row should have been deleted';
  end if;
  if not exists (select 1 from public.investment_transactions where transaction_id = v_planned) then
    raise exception 'a still-planned pending row must survive';
  end if;
  if not exists (select 1 from public.investment_transactions where transaction_id = v_recorded) then
    raise exception 'a recorded (units-bearing) buy must survive';
  end if;
  if not exists (select 1 from public.investment_transactions where transaction_id = v_manual) then
    raise exception 'a manual (non-seeded) fund tx must survive';
  end if;

  raise notice 'backfill_orphan_dca.test.sql: OK';
end $$;

rollback;
