-- Regression for #638: an accumulating book may stop accepting new tranches
-- before maturity. Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_book uuid := gen_random_uuid();
  v_ungrouped uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_other_goal uuid;
  v_other_book uuid := gen_random_uuid();
  v_message text;
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

  -- An existing ungrouped investment cannot bypass the same lock by joining
  -- the book after the cutoff.
  begin
    insert into public.investment_transactions (
      transaction_id, user_id, goal_id, asset_type, transaction_type,
      investment_date, expiry_date, amount_vnd, interest_rate
    ) values (v_ungrouped, v_user, v_goal, 'bank', 'investment',
      '2026-08-04', '2026-09-03', 1000000, 4);
    update public.investment_transactions set deposit_group_id = v_book
      where transaction_id = v_ungrouped;
    raise exception 'joining a locked book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- A SECURITY DEFINER guard must not reveal a foreign book's lock state or
  -- maturity before the ownership protection rejects the reference.
  insert into auth.users (id, email) values (v_other_user, 'accumulating-topup-lock-other@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_other_user, 'Foreign lock') returning goal_id into v_other_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_other_book, v_other_user, v_other_goal, 'bank', 'investment',
    '2026-01-01', '2026-09-03', 10000000, 4,
    v_other_book, 30
  );
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_user, v_goal, 'bank', 'investment', '2026-08-04',
      '2026-09-03', 1000000, 4, v_other_book);
    raise exception 'a foreign book must be rejected';
  exception when no_data_found then
    get stacked diagnostics v_message = message_text;
    if v_message <> 'accumulating top-up: accumulating book not found' then
      raise exception 'foreign book metadata leaked: %', v_message;
    end if;
  end;

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
