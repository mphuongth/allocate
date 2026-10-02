-- A renewal must not rewrite the month a deposit was saved in (20261002000001).
--
-- Planning credits a month with the bank deposits that carry its plan_id, at
-- their amount_vnd. A renewal rolls the live row forward IN PLACE — new
-- principal (+ interest, + any merged cash) — and that row kept the plan_id of
-- the month it was first opened, so the month's "contributed" grew with every
-- renewal: 10M saved in June read 10.3M after one renewal, 10.6M after two.
-- Collapsing a book was worse: each top-up tranche carried its own month's
-- plan_id, and the collapse deleted the tranche, so those months lost their
-- contribution while the anchor's month took the whole book.
--
-- The month belongs to the money saved in it — the cycle that was opened then.
-- So the renewal snapshot of that cycle keeps the plan_id, and the live row,
-- now a later cycle funded by money already counted, carries none.
--
-- Run AS THE USER (role authenticated + JWT subject): every renewal RPC is
-- security invoker, so RLS is part of what is being proven.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user   uuid := gen_random_uuid();
  v_today  date := public.business_today();
  v_goal   uuid;
  v_p1     uuid;  -- the plan of the month the deposit / book was opened
  v_p2     uuid;  -- a later month's plan (a book top-up)
  v_dep    uuid;
  v_dep2   uuid;
  v_anchor uuid;
  v_tr     uuid;
  v_legacy uuid;
  v_snap   uuid;
  v_sum    bigint;
  v_count  int;
begin
  insert into auth.users (id, email) values (v_user, 'renew-plan-month@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Wealth Max') returning goal_id into v_goal;
  insert into public.monthly_plans (user_id, month, year, salary_vnd) values (v_user, 1, 2026, 30000000) returning id into v_p1;
  insert into public.monthly_plans (user_id, month, year, salary_vnd) values (v_user, 2, 2026, 30000000) returning id into v_p2;

  insert into public.investment_transactions
    (user_id, goal_id, plan_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, v_p1, 'bank', 'investment', v_today - 184, 10000000, 6, v_today - 2)
  returning transaction_id into v_dep;

  insert into public.investment_transactions
    (user_id, goal_id, plan_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, v_p2, 'bank', 'investment', v_today - 184, 20000000, 6, v_today - 2)
  returning transaction_id into v_dep2;

  -- A book opened in month 1, topped up in month 2.
  v_anchor := gen_random_uuid();
  insert into public.investment_transactions
    (transaction_id, user_id, goal_id, plan_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, deposit_group_id)
  values (v_anchor, v_user, v_goal, v_p1, 'bank', 'investment', v_today - 200, 5000000, 6, v_today - 2, v_anchor);
  insert into public.investment_transactions
    (user_id, goal_id, plan_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, deposit_group_id)
  values (v_user, v_goal, v_p2, 'bank', 'investment', v_today - 170, 3000000, 6, v_today - 2, v_anchor)
  returning transaction_id into v_tr;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) a plain renewal: the month keeps what was saved in it ─────────────
  perform public.renew_term_deposit(v_dep, 10300000, 6.5, v_today + 180, v_today - 2, 300000);
  select coalesce(sum(amount_vnd), 0) into v_sum from public.investment_transactions
   where plan_id = v_p1 and asset_type = 'bank'
     and (transaction_id = v_dep or renewed_from_transaction_id = v_dep);
  if v_sum <> 10000000 then
    raise exception 'after one renewal month 1 must still show the 10,000,000 saved in it, shows %', v_sum;
  end if;
  select count(*) into v_count from public.investment_transactions where transaction_id = v_dep and plan_id is null;
  if v_count <> 1 then
    raise exception 'the renewed live cycle must carry no plan — its money was saved in an earlier month';
  end if;

  -- A second renewal does not move the month either.
  perform public.renew_term_deposit(v_dep, 10630000, 6.5, v_today + 360, v_today + 1, 330000);
  select coalesce(sum(amount_vnd), 0), count(*) into v_sum, v_count from public.investment_transactions
   where plan_id = v_p1 and asset_type = 'bank'
     and (transaction_id = v_dep or renewed_from_transaction_id = v_dep);
  if v_sum <> 10000000 or v_count <> 1 then
    raise exception 'after two renewals month 1 must show one 10,000,000 row, shows % in % row(s)', v_sum, v_count;
  end if;

  -- ── 2) the merge path (here: renewing into another bank) ────────────────
  perform public.renew_term_deposit_with_merge(
    p_tx_id => v_dep2, p_amount_vnd => 20600000, p_interest_rate => 6.5,
    p_expiry_date => v_today + 180, p_investment_date => v_today - 2,
    p_interest_earned_vnd => 600000, p_bank_code => 'VCB');
  select coalesce(sum(amount_vnd), 0) into v_sum from public.investment_transactions
   where plan_id = v_p2 and asset_type = 'bank'
     and (transaction_id = v_dep2 or renewed_from_transaction_id = v_dep2);
  if v_sum <> 20000000 then
    raise exception 'a renewal through the merge path must leave month 2 at 20,000,000, shows %', v_sum;
  end if;

  -- ── 3) collapsing a book: each month keeps its own tranche ──────────────
  perform public.collapse_accumulating_book(
    p_group_id => v_anchor, p_amount_vnd => 8240000, p_interest_rate => 6.5,
    p_expiry_date => v_today + 180, p_investment_date => v_today - 2,
    p_tranche_ids => array[v_anchor, v_tr], p_tranche_interest => array[160000::bigint, 80000::bigint]);
  select coalesce(sum(amount_vnd), 0) into v_sum from public.investment_transactions
   where plan_id = v_p1 and asset_type = 'bank'
     and (transaction_id = v_anchor or renewed_from_transaction_id = v_anchor);
  if v_sum <> 5000000 then
    raise exception 'after a collapse month 1 must show the anchor''s 5,000,000, shows %', v_sum;
  end if;
  select coalesce(sum(amount_vnd), 0) into v_sum from public.investment_transactions
   where plan_id = v_p2 and asset_type = 'bank'
     and (transaction_id = v_anchor or renewed_from_transaction_id = v_anchor);
  if v_sum <> 3000000 then
    raise exception 'after a collapse month 2 must keep its 3,000,000 top-up, shows %', v_sum;
  end if;

  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ── 4) the repair for renewals made before this fix ──────────────────────
  -- The shape they left: the live row holding the plan at its renewed amount,
  -- the first cycle's snapshot holding none.
  insert into public.investment_transactions
    (user_id, goal_id, plan_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, v_p1, 'bank', 'investment', v_today - 2, 7700000, 6, v_today + 180)
  returning transaction_id into v_legacy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, renewed_from_transaction_id, affects_progress)
  values (v_user, v_goal, 'bank', 'investment', v_today - 366, 7000000, 6, v_today - 184, v_legacy, false),
         (v_user, v_goal, 'bank', 'investment', v_today - 184, 7350000, 6, v_today - 2, v_legacy, false);
  select transaction_id into v_snap from public.investment_transactions
   where renewed_from_transaction_id = v_legacy and amount_vnd = 7000000;

  perform public.move_renewed_plan_month_to_first_cycle();

  select count(*) into v_count from public.investment_transactions where transaction_id = v_snap and plan_id = v_p1;
  if v_count <> 1 then
    raise exception 'the repair must give the month back to the first cycle (7,000,000)';
  end if;
  select count(*) into v_count from public.investment_transactions where transaction_id = v_legacy and plan_id is null;
  if v_count <> 1 then
    raise exception 'the repair must take the month off the renewed live row';
  end if;
  select count(*) into v_count from public.investment_transactions
   where renewed_from_transaction_id = v_legacy and amount_vnd = 7350000 and plan_id is not null;
  if v_count <> 0 then
    raise exception 'only the first cycle takes the month, not every snapshot';
  end if;

  -- Idempotent: a second run changes nothing.
  perform public.move_renewed_plan_month_to_first_cycle();
  select count(*) into v_count from public.investment_transactions where plan_id = v_p1 and transaction_id = v_snap;
  if v_count <> 1 then
    raise exception 'running the repair twice must leave the same answer';
  end if;

  -- Users cannot run the repair.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.move_renewed_plan_month_to_first_cycle();
    raise exception 'sentinel: the repair must not be executable by a user';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  raise notice 'renewal_keeps_plan_month: all assertions passed';
end;
$$;

rollback;
