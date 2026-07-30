-- A withdrawal can never take more than its holding still holds (#587).
--
-- The sell/withdraw sheets capped the amount client-side; the API took whatever
-- was posted. A stale tab, a retry, or two sells racing each other could each
-- pass their own read of the balance and both insert, so the holding went
-- negative: the dashboard drops it (effectiveAmount <= 0) while the withdrawal
-- history keeps the excess cash, and net worth is wrong for good.
--
-- The cap belongs where every writer meets it — the route, the renewal RPCs, the
-- book RPC, and whatever writes next — so it is a trigger on the table, taking a
-- row lock on the SOURCE before it reads the sums. That ordering is what makes
-- two concurrent sells serialize instead of both passing (the lock releases only
-- on commit, and the next statement then reads a fresh snapshot).
--
-- Two balances, per the dashboard's own two buckets:
--   • bank / gold / stock — one source row, addressed by parent_transaction_id.
--   • fund — the (goal, fund) bucket the overview aggregates, since a fund sell
--     has no parent row.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_goal    uuid;
  v_goal_b  uuid;
  v_fund    uuid;
  v_bank    uuid;
  v_gold    uuid;
  v_seed    uuid;
  -- Each attempt below catches ONLY 23514 (check_violation). Any other error
  -- propagates and fails the test: counting a null-violation as "rejected" would
  -- pass while proving nothing.
  v_msg     text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-balance@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car') returning goal_id into v_goal_b;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TFX', 'equity', 20000) returning id into v_fund;

  -- ── bank: principal is the balance ────────────────────────────────────────
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;

  -- 60M out of 100M: fine.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 61000000, v_bank, 60000000);

  -- 50M more would take 110M out of a 100M book.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 50000000, v_bank, 50000000);
    raise exception 'a withdrawal above the remaining principal must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  -- The route matches on this text to answer 400 instead of a generic 500, so
  -- the wording is a contract, not a detail (see the POST route).
  if v_msg not like '%exceeds the remaining balance%' then
    raise exception 'the refusal must say it exceeds the remaining balance, got: %', v_msg;
  end if;

  -- Exactly the remaining 40M: the boundary is allowed, not off by one.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-04-01', 40000000, v_bank, 40000000);

  -- Now empty: even 1 đồng is refused.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-05-01', 1, v_bank, 1);
    raise exception 'a withdrawal from a fully withdrawn deposit must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── gold: units are the balance ───────────────────────────────────────────
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 80000000, 10, 8000000) returning transaction_id into v_gold;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 50000000, v_gold, 48000000, 6);

  -- 5 more chỉ out of the 4 left — refused on units even though the cost basis
  -- passed would still fit inside the remaining principal.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 20000000, v_gold, 1000000, 5);
    raise exception 'selling more units than the holding has must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  if v_msg not like '%units%' then
    raise exception 'the units refusal must name units, got: %', v_msg;
  end if;

  -- The remaining 4 chỉ sell fine.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 33000000, v_gold, 32000000, 4);

  -- ── funds: the (goal, fund) bucket ────────────────────────────────────────
  -- 100 + 50 units in the House goal.
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-02-01', 1000000, 50, 20000);

  -- 120 of the 150 units held in that goal.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-03-01', 2400000, 2400000, 120);

  -- 40 more against the 30 left.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-04-01', 800000, 500000, 40);
    raise exception 'a fund sell above the units held in that goal must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- The SAME fund in another goal is a different balance: the House units must
  -- not fund a Car sell. (Selling 10 units from a goal holding nothing.)
  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal_b, v_fund, 'fund', 'withdrawal', '2026-04-01', 200000, 200000, 10);
    raise exception 'a fund sell must not draw on another goal''s units';
  exception when sqlstate '23514' then null;
  end;

  -- Unallocated is its own bucket too, and it is empty for this fund.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, null, v_fund, 'fund', 'withdrawal', '2026-04-01', 200000, 200000, 10);
    raise exception 'an unallocated fund sell must not draw on a goal''s units';
  exception when sqlstate '23514' then null;
  end;

  -- The 30 units actually left in the House goal still sell.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-05-01', 600000, 600000, 30);

  -- ── a pending DCA seed is not a holding ───────────────────────────────────
  -- Seeded rows carry the planned amount with no units until the buy is
  -- recorded; the dashboard never values them, so they cannot back a sell.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, is_dca_seeded)
  values (v_user, v_goal_b, v_fund, 'fund', 'investment', '2026-06-01', 5000000, null, true)
  returning transaction_id into v_seed;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal_b, v_fund, 'fund', 'withdrawal', '2026-06-02', 1000000, 1000000, 50);
    raise exception 'a pending DCA seed must not back a sell';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'withdrawal balance invariant: ok';
end;
$$;

-- ── units rounding: a full sell must not be refused by the 4th decimal ───────
-- Clients round units_withdrawn to 4 dp (parseFloat(x.toFixed(4))), so a full
-- sell of 50.12345 units posts 50.1235 — more than the holding, by 0.00005.
-- Refusing that would make "sell everything" fail; the tolerance is exactly one
-- unit of that rounding, so a real overdraw is still refused.
do $$
declare
  v_user  uuid;
  v_fund  uuid;
  v_fund2 uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-rounding@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Rounding Fund', 'RFX', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-01-01', 1000000, 50.12345, 20000);

  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, 1000000, 50.1235);

  -- A tenth of a unit over is not rounding.
  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-03-01', 1000, 1000, 0.1);
    raise exception 'the rounding tolerance must not swallow a real overdraw';
  exception when sqlstate '23514' then null;
  end;

  -- Nothing left means nothing to round. A holding sold out to EXACTLY zero (no
  -- rounding remainder to hide behind) must not still yield 0.0001 units, or every
  -- empty bucket carries a balance it never had — and with principal_withdrawn
  -- omitted, that is a withdrawal carrying any amount_vnd it likes against a
  -- holding that is gone.
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Exact Fund', 'EXF', 'equity', 20000) returning id into v_fund2;

  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund2, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund2, 'fund', 'withdrawal', '2026-02-01', 2000000, 2000000, 100);

  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units_withdrawn)
    values (v_user, v_fund2, 'fund', 'withdrawal', '2026-03-01', 5000000, 0.0001);
    raise exception 'an empty holding must not get the rounding tolerance as a balance';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'withdrawal units rounding tolerance: ok';
end;
$$;

rollback;
