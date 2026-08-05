-- Regression for #638: an accumulating book may stop accepting new tranches
-- before maturity. Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_book uuid := gen_random_uuid();
  v_ungrouped uuid := gen_random_uuid();
  v_parked uuid := gen_random_uuid();
  v_moving_book uuid := gen_random_uuid();
  v_moving_tranche uuid := gen_random_uuid();
  v_other_user uuid := gen_random_uuid();
  v_other_goal uuid;
  v_other_book uuid := gen_random_uuid();
  v_historical_book uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_message text;
  v_lock_days integer;
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

  -- Nor by parking the row outside the trigger's reach: a booked tranche that
  -- is turned into a withdrawal, redated inside the lock window and turned back
  -- into an investment must face the policy on the way back in.
  begin
    insert into public.investment_transactions (
      transaction_id, user_id, goal_id, asset_type, transaction_type,
      investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_parked, v_user, v_goal, 'bank', 'investment',
      '2026-07-01', '2026-09-03', 1000000, 4, v_book);
    update public.investment_transactions
       set transaction_type = 'withdrawal', parent_transaction_id = v_book,
           principal_withdrawn = 1000000
     where transaction_id = v_parked;
    update public.investment_transactions set investment_date = '2026-08-04'
     where transaction_id = v_parked;
    update public.investment_transactions
       set transaction_type = 'investment', parent_transaction_id = null,
           principal_withdrawn = null
     where transaction_id = v_parked;
    raise exception 'a redated tranche must be refused when it becomes an investment again';
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

  -- Naming the book's owner in user_id does not buy the answer either. RLS
  -- rejects a row the caller will not own, but only AFTER before-row triggers
  -- run, so the guard must decline to speak for a row that is not the caller's.
  -- The grant mirrors the deployed database, where `authenticated` is the role
  -- PostgREST uses; the surrounding transaction rolls it back.
  grant select, insert on public.investment_transactions to authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    set local role authenticated;
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_other_user, v_other_goal, 'bank', 'investment', '2026-08-04',
      '2026-09-03', 1000000, 4, v_other_book);
    reset role;
    raise exception 'impersonating the book owner must be rejected';
  exception when insufficient_privilege then
    reset role;
  when others then
    reset role;
    get stacked diagnostics v_message = message_text;
    raise exception 'foreign book metadata leaked to an impersonating caller: %', v_message;
  end;

  -- The same authenticated caller still meets the policy on their own book:
  -- declining to speak for foreign rows must not disable the guard.
  begin
    set local role authenticated;
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_user, v_goal, 'bank', 'investment', '2026-08-04',
      '2026-09-03', 1000000, 4, v_book);
    reset role;
    raise exception 'an authenticated owner must still meet the lock window';
  exception when sqlstate '23514' then
    reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- The recurring RPC uses the entered date too: a backfilled contribution from
  -- before maturity remains valid even if the book is now past maturity.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_historical_book, v_user, v_goal, 'bank', 'investment',
    current_date - 31, current_date - 1, 10000000, 4, v_historical_book
  );
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (
    v_saving, v_user, v_goal, 'Historical recurring', 1000000, v_historical_book
  );
  perform public.record_recurring_book_topup(
    v_historical_book, 1000000, 4, current_date - 2, v_saving,
    to_char(current_date - 2, 'YYYY-MM')
  );

  -- A recurring tranche carries the book's lock window like a manual one does.
  -- Goal detail reads book metadata off whichever group row its page contains,
  -- so a tranche without it renders the book as open.
  update public.investment_transactions set top_up_lock_days = 30
   where transaction_id = v_historical_book;
  select top_up_lock_days into v_lock_days
    from public.record_recurring_book_topup(
      v_historical_book, 1000000, 4, current_date - 40, v_saving,
      to_char(current_date - 40, 'YYYY-MM')
    );
  if v_lock_days is distinct from 30 then
    raise exception 'a recurring tranche must carry the book lock window, got %', v_lock_days;
  end if;

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

  -- ── Moving the book's maturity is the same decision, from the other side ──
  -- v_moving holds one tranche dated 2026-08-04, well inside a 2026-12-31 book.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_moving_book, v_user, v_goal, 'bank', 'investment',
    '2026-01-01', '2026-12-31', 10000000, 4, v_moving_book, 30
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_moving_tranche, v_user, v_goal, 'bank', 'investment',
    '2026-08-04', '2026-12-31', 1000000, 4, v_moving_book
  );

  -- Pulling maturity in until that tranche sits inside the lock window is the
  -- refusal the tranche's own date would have earned.
  begin
    perform public.update_deposit_book(
      v_moving_book, false, null, true, '2026-09-03'::date, false, null,
      false, null, false, null, false, null, false, null);
    raise exception 'shortening maturity into the lock window must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Pulling it in past the tranche entirely leaves money in a dead book.
  begin
    perform public.update_deposit_book(
      v_moving_book, false, null, true, '2026-07-01'::date, false, null,
      false, null, false, null, false, null, false, null);
    raise exception 'shortening maturity past a tranche must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Pushing maturity out is always fine.
  perform public.update_deposit_book(
    v_moving_book, false, null, true, '2027-06-30'::date, false, null,
    false, null, false, null, false, null, false, null);

  -- Adopting or tightening the policy on an existing book stays possible: the
  -- lock window governs tranches recorded from then on, and the stored value is
  -- an editable snapshot (#638). Only a maturity move re-judges what is already
  -- in the book.
  update public.investment_transactions set top_up_lock_days = 400
   where transaction_id = v_moving_book;

  raise notice 'accumulating top-up lock: OK';
end;
$$;

rollback;
