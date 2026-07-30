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

-- ── the balance a row is measured against must be the one it draws down ──────
-- Two ways to hand the invariant the wrong balance, both caught by review on
-- PR #599:
--
--   1. A fund withdrawal carrying BOTH fund_id and parent_transaction_id.
--      lib/withdrawalProgress keys any row with asset_type='fund' + fund_id by
--      (goal, fund) and ignores its parent — so measuring it against the parent
--      instead lets a fat deposit in one goal wave through a phantom fund sell
--      in another. The check has to follow the same precedence the valuation does.
--   2. Staging the row as an investment and flipping transaction_type afterwards.
--      A one-column update has to re-measure, or the guard is opt-in.
do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_goal_b uuid;
  v_fund  uuid;
  v_fat   uuid;
  v_staged uuid;
  v_sold  uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-bucket@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car') returning goal_id into v_goal_b;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Bucket Fund', 'BKF', 'equity', 20000) returning id into v_fund;

  -- Plenty of this fund held in the House goal — principal AND units, so the
  -- parent-row check would pass on both counts if it were the one applied.
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 4000000, 200, 20000) returning transaction_id into v_fat;

  -- 1) The Car goal holds none of the fund. Parenting the sell to the fat House
  --    row must not buy it a balance: the dashboard will subtract these units
  --    from (Car, fund), which holds nothing.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date,
       amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal_b, v_fund, 'fund', 'withdrawal', '2026-02-01',
            2000000, v_fat, 2000000, 100);
    raise exception 'a fund sell must be measured against its fund bucket, not its parent';
  exception when sqlstate '23514' then null;
  end;

  -- 2) Staged as an investment (which the invariant leaves alone, since an
  --    investment draws nothing down), then activated. 9M of principal against a
  --    4M holding.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 9000000, v_fat, 9000000)
  returning transaction_id into v_staged;

  begin
    update public.investment_transactions
       set transaction_type = 'withdrawal'
     where transaction_id = v_staged;
    raise exception 'becoming a withdrawal must be measured too';
  exception when sqlstate '23514' then null;
  end;

  -- 3) Changing asset_type off 'fund' takes the row out of the fund bucket
  --    (buildWithdrawalMaps stops keying it by goal/fund) and, with no parent, it
  --    then subtracts from nothing at all: the sold units come back into net worth
  --    while the withdrawal record stays. Adding asset_type to the trigger's
  --    columns only gets the trigger to run — what refuses the change is that a
  --    withdrawal drawing on NO holding is not a withdrawal.
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, v_fund, 'fund', 'withdrawal', '2026-02-01', 2000000, 2000000, 100)
  returning transaction_id into v_sold;

  begin
    update public.investment_transactions
       set asset_type = 'bank'
     where transaction_id = v_sold;
    raise exception 'a withdrawal must not be able to stop drawing on anything';
  exception when sqlstate '23514' then null;
  end;

  -- Same shape, created directly: principal out of thin air, attached to nothing.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 7000000, 7000000);
    raise exception 'a withdrawal with no holding to draw on must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'withdrawal bucket precedence + activation: ok';
end;
$$;

-- ── the parent has to be a holding, and deleting one must stay possible ──────
-- A withdrawal is not a holding: parenting to one invents a balance out of money
-- that already left. Renewal snapshots, on the other hand, are valid parents on
-- purpose — renew and collapse re-parent partial withdrawals onto them (#585).
--
-- A FUND purchase as parent is bounded by that row rather than refused: such a
-- row is ignored by buildWithdrawalMaps, so it is an uncounted withdrawal rather
-- than an overdraw (a valuation gap older than this change, and a shape
-- dca_seeding_heal.test.sql treats as data that exists).
do $$
declare
  v_user uuid;
  v_goal uuid;
  v_fund uuid;
  v_buy  uuid;
  v_dep  uuid;
  v_wd   uuid;
  v_snap uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-parent@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Parent Fund', 'PRF', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 90000000, 4500, 20000) returning transaction_id into v_buy;

  -- Parented to that fund purchase: allowed, but still bounded by the row it
  -- names — 90M is there, 200M is not.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 10000000, v_buy, 10000000);

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-02', 200000000, v_buy, 200000000);
    raise exception 'even an oddly parented withdrawal is bounded by the row it names';
  exception when sqlstate '23514' then null;
  end;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_dep;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 30000000, v_dep, 30000000) returning transaction_id into v_wd;

  -- A withdrawal is not a holding: parenting to one is a phantom balance.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 20000000, v_wd, 20000000);
    raise exception 'a withdrawal must not draw on another withdrawal';
  exception when sqlstate '23514' then null;
  end;

  -- A renewal snapshot IS a valid parent — renew/collapse re-parent onto it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, renewed_from_transaction_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, v_dep) returning transaction_id into v_snap;

  update public.investment_transactions set parent_transaction_id = v_snap where transaction_id = v_wd;

  -- Detaching a withdrawal while its source is still there is not a deletion: the
  -- holding comes back to full value and the withdrawal is filed under no key at
  -- all. Only the FK's own ON DELETE SET NULL may orphan a row, and the tell is
  -- that the source is already gone by then.
  begin
    update public.investment_transactions
       set parent_transaction_id = null
     where transaction_id = v_wd;
    raise exception 'a withdrawal must not be detached from a source that still exists';
  exception when sqlstate '23514' then null;
  end;

  -- Deleting a source that has withdrawals is an ordinary ledger action. The FK
  -- is ON DELETE SET NULL, so Postgres orphans the children — an UPDATE that
  -- lands on this trigger. It must not turn a delete into an error.
  delete from public.investment_transactions where transaction_id = v_snap;

  if (select parent_transaction_id from public.investment_transactions where transaction_id = v_wd) is not null then
    raise exception 'the orphaned withdrawal should have lost its parent';
  end if;

  raise notice 'withdrawal parent kinds + source deletion: ok';
end;
$$;

-- ── the bucket must hold only what the valuation counts, and only forwards ───
do $$
declare
  v_user uuid;
  v_goal uuid;
  v_fund uuid;
  v_buy  uuid;
  v_dep  uuid;
  v_sell uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-bucket2@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Bucket2 Fund', 'BK2', 'equity', 20000) returning id into v_fund;

  -- A fund purchase whose asset_type is edited to 'bank' keeps its fund_id (the
  -- PUT route clears fund_id only when that field is sent). The dashboard then
  -- values it as a bank holding — so its units are no longer fund inventory and
  -- must not back a fund sell.
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;

  update public.investment_transactions set asset_type = 'bank' where transaction_id = v_buy;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, 1000000, 50);
    raise exception 'units that are no longer valued as a fund must not back a fund sell';
  exception when sqlstate '23514' then null;
  end;

  -- A negative withdrawal runs the ledger backwards: it ADDS to the holding and
  -- leaves a credit the next withdrawal can spend. Nothing in the schema stops
  -- one, so the invariant has to.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_dep;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 100000, v_dep, -100000000);
    raise exception 'a negative principal withdrawal must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 100000, v_dep, 0, -5);
    raise exception 'a negative units withdrawal must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- And the deposit still has its whole balance: nothing was credited to it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 100000000, v_dep, 100000000);

  -- Deleting the FUND is the same story as deleting a deposit: fund_id is also
  -- ON DELETE SET NULL, so the sells are orphaned by an update that lands here.
  -- Only the FK may do it — detaching a sell from a fund that still exists puts
  -- the units back and files the sell under no key at all.
  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, 1000000, 50)
  returning transaction_id into v_sell;

  begin
    update public.investment_transactions set fund_id = null where transaction_id = v_sell;
    raise exception 'a sell must not be detached from a fund that still exists';
  exception when sqlstate '23514' then null;
  end;

  delete from public.funds where id = v_fund;

  if (select fund_id from public.investment_transactions where transaction_id = v_sell) is not null then
    raise exception 'deleting the fund should have orphaned its sell';
  end if;

  raise notice 'withdrawal bucket asset type + negative amounts + fund deletion: ok';
end;
$$;

-- ── relocating a bucket is a multi-row move, and row order must not decide it ─
-- POST /api/v1/fund-investments/assign moves a fund's purchases AND its sells to
-- the new goal in ONE update. A row trigger sees that statement half-applied, so
-- whether the destination bucket looked complete depended on heap order: after an
-- ordinary edit of the purchase (which rewrites it to the end of the heap), the
-- sell was visited first, measured against an empty destination, and an everyday
-- assign returned 500. Deleting a goal does the same thing through
-- ON DELETE SET NULL. The relocation check is therefore deferred to the end of
-- the statement — but it still has to refuse a sell moved somewhere on its own.
do $$
declare
  v_user uuid;
  v_a    uuid;
  v_b    uuid;
  v_fund uuid;
  v_buy  uuid;
  v_sell uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-move@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'A') returning goal_id into v_a;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'B') returning goal_id into v_b;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Move Fund', 'MVF', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_a, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_a, v_fund, 'fund', 'withdrawal', '2026-02-01', 600000, 600000, 30) returning transaction_id into v_sell;

  -- Editing the purchase rewrites it to the end of the heap, so the bulk update
  -- below visits the SELL first. This is the order that used to fail.
  update public.investment_transactions set notes = 'edited' where transaction_id = v_buy;

  update public.investment_transactions
     set goal_id = v_b, updated_at = now()
   where user_id = v_user and fund_id = v_fund and asset_type = 'fund' and goal_id = v_a;

  if (select count(*) from public.investment_transactions
       where fund_id = v_fund and goal_id = v_b) <> 2 then
    raise exception 'the whole bucket should have moved';
  end if;

  -- Deleting the goal relocates the bucket to Unallocated the same way.
  delete from public.savings_goals where goal_id = v_b;

  if (select count(*) from public.investment_transactions
       where fund_id = v_fund and goal_id is null) <> 2 then
    raise exception 'deleting the goal should have moved the whole bucket to unallocated';
  end if;

  -- But a sell moved on its own still has to be refused — the units stay in one
  -- bucket while the sale is filed against another. Deferred means the error
  -- arrives at the end of the statement, not during it.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'C') returning goal_id into v_a;
  begin
    update public.investment_transactions set goal_id = v_a where transaction_id = v_sell;
    raise exception 'moving a lone sell into a bucket that holds nothing must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'withdrawal bucket relocation: ok';
end;
$$;

-- ── a fund sell records both deltas, and losing a fund re-measures the parent ─
do $$
declare
  v_user uuid;
  v_goal uuid;
  v_fund uuid;
  v_small uuid;
  v_sell  uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-deltas@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Deltas Fund', 'DLF', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 20000000, 1000, 20000);

  -- Units but no principal: the units fall while the cost basis stays, so P&L is
  -- wrong. Principal but no units: the overview bails on `units <= 0` and skips
  -- the subtraction entirely, leaving the holding untouched while the balance was
  -- consumed. Neither is a shape the sell sheets produce.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units_withdrawn)
    values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, 50);
    raise exception 'a fund sell without principal_withdrawn must be refused';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn)
    values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, 1000000);
    raise exception 'a fund sell without units_withdrawn must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- A sell carrying BOTH a fund and a parent is measured against the fund bucket
  -- (mirroring buildWithdrawalMaps). Delete the fund and the same row starts
  -- drawing on its parent instead — which may be far smaller, so losing the fund
  -- has to re-measure rather than wave the row through.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1000000) returning transaction_id into v_small;

  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 10000000, v_small, 10000000, 500)
  returning transaction_id into v_sell;

  begin
    delete from public.funds where id = v_fund;
    raise exception 'losing the fund must re-measure the sell against its parent';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'fund sell deltas + re-measure on fund loss: ok';
end;
$$;

-- ── a full fund sell must survive the two cost bases disagreeing ─────────────
-- The bucket's principal is measured as Σ amount_vnd; the sell builders derive
-- what they post from the NAV cost basis (Σ units × unit_price). Each stored
-- amount_vnd was itself rounded, so on a multi-purchase bucket the two differ by
-- a đồng or two — enough to refuse an ordinary "sell everything" without a slack
-- of exactly that size.
do $$
declare
  v_user uuid;
  v_fund uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-basis@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Basis Fund', 'BSF', 'equity', 20000) returning id into v_fund;

  -- Two purchases whose raw basis is 1,000,050.4 each: stored amount_vnd rounds
  -- DOWN to 1,000,050, so Σ amount_vnd = 2,000,100 while the NAV cost the sheet
  -- computes rounds to 2,000,101.
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-01-01', 1000050, 50.0025, 20000);
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-02-01', 1000050, 50.0025, 20000);

  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund, 'fund', 'withdrawal', '2026-03-01', 2000101, 2000101, 100.005);

  -- The slack is bounded, not a licence: a thousand đồng over is still refused.
  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-04-01', 1000, 1000, 0.0001);
    raise exception 'the cost-basis slack must not cover a real overdraw';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'fund cost-basis slack: ok';
end;
$$;

-- ── every refusal is recognisable to the API ─────────────────────────────────
-- The route maps this family to a 400 by one prefix. When each message had to be
-- listed individually, a new refusal fell through as a 500 — an invalid request
-- reported as a server fault.
do $$
declare
  v_user uuid;
  v_fund uuid;
  v_msg  text;
  v_seen int := 0;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-prefix@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Prefix Fund', 'PXF', 'equity', 20000) returning id into v_fund;

  -- negative amounts
  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000, -1000, -1);
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
    if v_msg not like 'withdrawal invariant:%' then
      raise exception 'the negative-amount refusal must carry the prefix, got: %', v_msg;
    end if;
    v_seen := v_seen + 1;
  end;

  -- incomplete fund deltas
  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000, 1000);
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
    if v_msg not like 'withdrawal invariant:%' then
      raise exception 'the incomplete-deltas refusal must carry the prefix, got: %', v_msg;
    end if;
    v_seen := v_seen + 1;
  end;

  -- an empty bucket
  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000, 1000, 1);
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
    if v_msg not like 'withdrawal invariant:%' then
      raise exception 'the balance refusal must carry the prefix, got: %', v_msg;
    end if;
    v_seen := v_seen + 1;
  end;

  if v_seen <> 3 then
    raise exception 'expected three refusals, saw %', v_seen;
  end if;

  raise notice 'refusal prefix: ok';
end;
$$;

-- ── the helper is the trigger's, not the API's ───────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC, and this one is SECURITY
-- DEFINER: left open, a caller who knows a holding's UUID could invoke it with a
-- hand-built row, read the exact remaining balance out of the refusal message, and
-- take locks on those rows while they were at it.
do $$
begin
  begin
    set local role authenticated;
    -- A null composite is enough: EXECUTE is checked before the body runs.
    perform public.check_withdrawal_balance(null::public.investment_transactions);
    reset role;
    raise exception 'check_withdrawal_balance must not be callable by authenticated';
  exception
    when insufficient_privilege then
      reset role;
    when others then
      reset role;
      -- Anything else means the call got THROUGH the privilege check.
      raise exception 'expected a privilege error, got % (%)', sqlerrm, sqlstate;
  end;

  raise notice 'helper is not callable by the API roles: ok';
end;
$$;

-- ── each withdrawal is counted against ONE balance ───────────────────────────
do $$
declare
  v_user uuid;
  v_fund uuid;
  v_dep  uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-onecount@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'OneCount Fund', 'OCF', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  insert into public.investment_transactions (user_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_dep;

  -- A fund sell that also names a parent is measured against the FUND bucket
  -- (mirroring buildWithdrawalMaps, which ignores its parent). The parent's own
  -- balance must therefore not be reduced by it as well — counting it twice made a
  -- later, perfectly ordinary bank withdrawal look like an overdraw.
  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1000000, v_dep, 1000000, 50);

  -- The deposit still has all 100M.
  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, 'bank', 'withdrawal', '2026-03-01', 100000000, v_dep, 100000000);

  raise notice 'one withdrawal, one balance: ok';
end;
$$;

-- ── a purchase whose stored amount and NAV cost disagree outright ────────────
-- The POST route takes amount_vnd, units and unit_price as independent fields and
-- enforces no relationship between them, and the sheet lets units be typed by
-- hand. So a purchase can store 1,000,000 with 60 units at 20,000 — a NAV cost of
-- 1,200,000. The dashboard and the sell builders use the NAV basis, so a full sell
-- posts 1,200,000: measuring only against Σ amount_vnd refuses an ordinary sale.
-- The bound is whichever basis is larger; for funds, units are the load-bearing
-- check anyway.
do $$
declare
  v_user uuid;
  v_fund uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-navbasis@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'NavBasis Fund', 'NBF', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-01-01', 1000000, 60, 20000);

  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 1200000, 1200000, 60);

  raise notice 'fund principal bound takes the larger basis: ok';
end;
$$;

-- The other direction: a stored amount ABOVE the NAV cost is still the bound, and
-- neither basis licenses a real overdraw.
do $$
declare
  v_user uuid;
  v_fund uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-navbasis2@test.invalid') returning id into v_user;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'NavBasis2 Fund', 'NB2', 'equity', 20000) returning id into v_fund;

  -- amount_vnd 2,000,000 (fees included) vs NAV cost 1,200,000.
  insert into public.investment_transactions (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 60, 20000);

  insert into public.investment_transactions
    (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_fund, 'fund', 'withdrawal', '2026-02-01', 2000000, 2000000, 60);

  begin
    insert into public.investment_transactions
      (user_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_fund, 'fund', 'withdrawal', '2026-03-01', 500000, 500000, 0.0001);
    raise exception 'neither basis may license an overdraw';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'fund principal bound, other direction: ok';
end;
$$;

rollback;
