-- Regression test for the #466 duplicate-healing step in
-- 20260722000001_atomic_dca_seeding.sql.
--
-- The healing must reduce each (plan_id, fund_id) group to a single
-- is_dca_seeded row so the partial unique index can build — but it must NEVER
-- delete a recorded (units-bearing) purchase, and must never orphan a
-- withdrawal that references one (the parent_transaction_id FK is ON DELETE SET
-- NULL). This reproduces the worst case: two duplicates BOTH recorded, plus a
-- pending duplicate, with a withdrawal hanging off one recorded row.
--
-- Runs against the local stack; everything happens inside a transaction that is
-- rolled back, so it mutates nothing. Any failed assertion RAISEs and, under
-- `psql -v ON_ERROR_STOP=1`, exits non-zero. Run via `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_goal uuid;
  v_fund uuid;
  v_plan uuid;
  v_rec1 uuid;   -- first recorded duplicate  (keeper)
  v_rec2 uuid;   -- second recorded duplicate (must survive as plain tx)
  v_pend uuid;   -- pending duplicate         (must be deleted)
  v_wd   uuid;   -- withdrawal hanging off v_rec2
  v_recorded_left int;
  v_seeded_left int;
  v_pending_left int;
  v_wd_parent uuid;
begin
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'heal-test@test.invalid') returning id into v_user;

  insert into savings_goals (user_id, goal_name)
    values (v_user, 'Heal Test Goal') returning goal_id into v_goal;

  insert into funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd, dca_goal_id)
    values (v_user, 'Heal Test Fund', 'HEALT', 'equity', 20000, true, 2000000, v_goal)
    returning id into v_fund;

  insert into monthly_plans (user_id, month, year, salary_vnd)
    values (v_user, 11, 2099, 50000000) returning id into v_plan;

  -- The corruption the old code could produce: TWO recorded seeded rows plus a
  -- pending one, all for the same (plan, fund). Drop the guard index so we can
  -- recreate that pre-migration state.
  drop index if exists investment_transactions_dca_seeded_uniq;

  insert into investment_transactions
    (user_id, plan_id, fund_id, goal_id, asset_type, amount_vnd, units, unit_price, investment_date, is_dca_seeded, created_at)
    values (v_user, v_plan, v_fund, v_goal, 'fund', 2000000, 100, 20000, '2099-11-01', true, now() - interval '2 min')
    returning transaction_id into v_rec1;

  insert into investment_transactions
    (user_id, plan_id, fund_id, goal_id, asset_type, amount_vnd, units, unit_price, investment_date, is_dca_seeded, created_at)
    values (v_user, v_plan, v_fund, v_goal, 'fund', 2000000, 50, 20000, '2099-11-01', true, now() - interval '1 min')
    returning transaction_id into v_rec2;

  insert into investment_transactions
    (user_id, plan_id, fund_id, goal_id, asset_type, amount_vnd, units, unit_price, investment_date, is_dca_seeded, created_at)
    values (v_user, v_plan, v_fund, v_goal, 'fund', 2000000, null, null, '2099-11-01', true, now())
    returning transaction_id into v_pend;

  -- A withdrawal referencing the second recorded row — this is what would be
  -- orphaned if the healing deleted v_rec2.
  insert into investment_transactions
    (user_id, parent_transaction_id, transaction_type, asset_type, amount_vnd, principal_withdrawn, investment_date, affects_progress)
    values (v_user, v_rec2, 'withdrawal', null, 500000, 500000, '2099-11-15', true)
    returning transaction_id into v_wd;

  -- ---- Run the healing exactly as the migration does -----------------------
  update investment_transactions it
     set is_dca_seeded = false, updated_at = now()
    from (
      select transaction_id,
             row_number() over (
               partition by plan_id, fund_id
               order by (units is not null) desc, created_at asc, transaction_id asc
             ) as rn
        from investment_transactions
       where is_dca_seeded and asset_type = 'fund' and plan_id is not null
    ) dup
   where it.transaction_id = dup.transaction_id and dup.rn > 1 and it.units is not null;

  delete from investment_transactions it
  using (
    select transaction_id,
           row_number() over (
             partition by plan_id, fund_id
             order by (units is not null) desc, created_at asc, transaction_id asc
           ) as rn
      from investment_transactions
     where is_dca_seeded and asset_type = 'fund' and plan_id is not null
  ) dup
  where it.transaction_id = dup.transaction_id and dup.rn > 1 and it.units is null;

  -- ---- Assertions ----------------------------------------------------------
  -- Both recorded purchases survive (nothing financial deleted).
  select count(*) into v_recorded_left
    from investment_transactions
   where plan_id = v_plan and fund_id = v_fund and asset_type = 'fund' and units is not null;
  if v_recorded_left <> 2 then
    raise exception 'expected 2 recorded rows to survive, found %', v_recorded_left;
  end if;

  -- Exactly one seeded row left → the partial unique index can build.
  select count(*) into v_seeded_left
    from investment_transactions
   where plan_id = v_plan and fund_id = v_fund and asset_type = 'fund' and is_dca_seeded;
  if v_seeded_left <> 1 then
    raise exception 'expected exactly 1 is_dca_seeded row, found %', v_seeded_left;
  end if;

  -- The pending duplicate is gone.
  select count(*) into v_pending_left
    from investment_transactions where transaction_id = v_pend;
  if v_pending_left <> 0 then
    raise exception 'pending duplicate should have been deleted';
  end if;

  -- The keeper (earliest recorded) stays flagged; the other recorded row is
  -- preserved but un-flagged.
  if not exists (select 1 from investment_transactions where transaction_id = v_rec1 and is_dca_seeded) then
    raise exception 'v_rec1 should remain the seeded keeper';
  end if;
  if not exists (select 1 from investment_transactions where transaction_id = v_rec2 and not is_dca_seeded) then
    raise exception 'v_rec2 should survive as a plain (un-flagged) transaction';
  end if;

  -- The withdrawal is not orphaned — its parent link is intact.
  select parent_transaction_id into v_wd_parent
    from investment_transactions where transaction_id = v_wd;
  if v_wd_parent is distinct from v_rec2 then
    raise exception 'withdrawal was orphaned: parent_transaction_id = %', v_wd_parent;
  end if;

  -- Recreating the real index must now succeed (no duplicate seeded rows left).
  create unique index investment_transactions_dca_seeded_uniq
    on investment_transactions (plan_id, fund_id)
    where is_dca_seeded and asset_type = 'fund';

  raise notice 'dca_seeding_heal.test.sql: OK';
end $$;

rollback;
