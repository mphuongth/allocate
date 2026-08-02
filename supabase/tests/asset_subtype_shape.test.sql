-- An investment row may carry only its own asset type's fields (#593).
--
-- The edit route clears the previous subtype on a type change, but the table has
-- other writers (RPCs, service-role scripts, psql), so the shape is a constraint
-- too — investment_transactions_subtype_shape, added in 20260802000001. This
-- pins both halves: every contradictory shape is refused, and every legitimate
-- one still lands.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_fund  uuid;
  v_bank  uuid;
  v_gold  uuid;
  v_gold2 uuid;
  v_fundtx uuid;
  -- Each attempt catches ONLY 23514 (check_violation): a null violation or a
  -- foreign-key error must fail the test, not count as "refused".
  v_ok    boolean;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'subtype-shape@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TSF', 'equity', 20000) returning id into v_fund;

  -- ── The legitimate shapes all land ────────────────────────────────────────
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, 5.5, '2027-01-01')
  returning transaction_id into v_bank;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, units, unit_price)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 10000000, v_fund, 500, 20000)
  returning transaction_id into v_fundtx;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 7000000, 2, 3500000)
  returning transaction_id into v_gold;

  -- ── Contradictory shapes are refused ──────────────────────────────────────

  -- Bank with a fund link.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id)
    values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1000000, v_fund);
    raise exception 'a bank deposit carrying fund_id must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Bank with units / unit price (the Gold -> Bank leftover).
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
    values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1000000, 2, 3500000);
    raise exception 'a bank deposit carrying units must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Fund with deposit terms (the Bank -> Fund leftover).
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, interest_rate)
    values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1000000, v_fund, 5.5);
    raise exception 'a fund carrying an interest rate must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, expiry_date)
    values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1000000, v_fund, '2027-01-01');
    raise exception 'a fund carrying a maturity date must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Gold with bank metadata (the Bank -> Gold leftover).
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, bank_code)
    values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000000, 2, 3500000, 'VCB');
    raise exception 'gold carrying a bank code must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, interest_earned_vnd)
    values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000000, 2, 50000);
    raise exception 'gold carrying renewal interest must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── The bug itself: a type change that leaves the old fields behind ───────
  begin
    update public.investment_transactions
    set asset_type = 'fund', fund_id = v_fund
    where transaction_id = v_bank;
    raise exception 'converting a deposit to a fund without clearing rate/maturity must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.investment_transactions
    set asset_type = 'bank'
    where transaction_id = v_gold;
    raise exception 'converting gold to a deposit without clearing units must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.investment_transactions
    set asset_type = 'gold'
    where transaction_id = v_fundtx;
    raise exception 'converting a fund to gold without clearing fund_id must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- The same conversions, done the way the route does them — old subtype
  -- cleared in the same statement — are accepted.
  update public.investment_transactions
  set asset_type = 'fund', fund_id = v_fund, units = 500, unit_price = 20000,
      interest_rate = null, expiry_date = null, bank_code = null,
      interest_earned_vnd = null, deposit_group_id = null
  where transaction_id = v_bank;

  update public.investment_transactions
  set asset_type = 'bank', units = null, unit_price = null, fund_id = null,
      interest_rate = 5.5, expiry_date = '2027-06-01'
  where transaction_id = v_gold;

  select exists (
    select 1 from public.investment_transactions
    where transaction_id = v_bank and asset_type = 'fund' and interest_rate is null and expiry_date is null
  ) into v_ok;
  if not v_ok then raise exception 'the converted deposit should now be a clean fund row'; end if;

  select exists (
    select 1 from public.investment_transactions
    where transaction_id = v_gold and asset_type = 'bank' and units is null and unit_price is null
  ) into v_ok;
  if not v_ok then raise exception 'the converted gold row should now be a clean deposit'; end if;

  -- ── Out of scope, and staying that way ───────────────────────────────────

  -- A withdrawal is a movement, not a holding: its shape is the withdrawal
  -- invariant's contract (20260730000002), so this constraint must not touch it.
  -- A gold sell legitimately carries units_withdrawn against its parent.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 7000000, 2, 3500000)
  returning transaction_id into v_gold2;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 4000000, v_gold2, 1, 3500000);

  -- (A null asset_type needs no case of its own: require_asset_type_for_investments
  -- already forbids it on an investment row, and withdrawals are out of scope.)

  raise notice 'asset subtype shape: OK';
end $$;

rollback;
