-- Regression for #638: an accumulating book may stop accepting new tranches
-- before maturity. Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_book uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'accumulating-topup-lock@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Top-up lock') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    '2026-01-01', '2026-09-03', 10000000, 4,
    v_book, 30
  );

  -- Exactly 30 days remaining is inside the inclusive lock window.
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_user, v_goal, 'bank', 'investment', '2026-08-04',
      '2026-09-03', 1000000, 4, v_book);
    raise exception 'a top-up at the lock boundary must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- 31 days is still allowed.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (v_user, v_goal, 'bank', 'investment', '2026-08-03',
    '2026-09-03', 1000000, 4, v_book);

  -- A maturity-day tranche would earn no term interest and must be refused even
  -- for legacy books without a configured pre-maturity lock.
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_user, v_goal, 'bank', 'investment', '2026-09-03',
      '2026-09-03', 1000000, 4, v_book);
    raise exception 'a maturity-day top-up must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'accumulating top-up lock: OK';
end;
$$;

rollback;
