-- Deleting a goal is one transaction, not four round trips (#687).
--
-- The route used to count linked transactions, look for parked cash, clear the
-- dead merge targets and delete the goal as four separate statements, ignoring
-- the errors of the first and third. Between the third and the fourth there is a
-- window: the cleanup commits, the delete fails, and consumed merge history has
-- lost the target it recorded while the goal it pointed at is still there.
--
-- delete_savings_goal does the whole transition under the goal's lock, so every
-- one of those steps either lands together or not at all.
--
-- Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_goal uuid;
  v_goal2 uuid;
  v_goal3 uuid;
  v_other_goal uuid;
  v_src uuid;
  v_anchor uuid;
  v_settlement uuid;
  v_kept uuid;
  v_result jsonb;
  v_target uuid;
  v_left int;
  v_msg text;
begin
  insert into auth.users (id, email) values (v_user, 'delete-goal@test.invalid');
  insert into auth.users (id, email) values (v_other, 'delete-goal-other@test.invalid');

  -- ── 1) the happy path: the goal goes, its transactions stay ────────────────
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Kitchen')
    returning goal_id into v_goal;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-02', 8000000);
  -- Unassigned already, and another user's row: neither may be counted.
  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, 'bank', 'investment', '2026-01-03', 1000000)
    returning transaction_id into v_kept;
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Theirs')
    returning goal_id into v_other_goal;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_other, v_other_goal, 'bank', 'investment', '2026-01-04', 5000000);

  v_result := public.delete_savings_goal(v_goal);

  -- The count is produced inside the transaction that did the delete, so it
  -- cannot describe a ledger that has since moved.
  if (v_result ->> 'moved')::int is distinct from 2 then
    raise exception 'expected 2 moved transactions, got %', v_result;
  end if;
  if exists (select 1 from public.savings_goals where goal_id = v_goal) then
    raise exception 'the goal must be gone';
  end if;
  -- ON DELETE SET NULL moved them to Unassigned; nothing was deleted.
  select count(*) into v_left from public.investment_transactions
   where user_id = v_user and goal_id is null;
  if v_left <> 3 then
    raise exception 'expected 3 unassigned transactions, got %', v_left;
  end if;
  if not exists (select 1 from public.investment_transactions
                  where user_id = v_other and goal_id = v_other_goal) then
    raise exception 'another user''s transactions must be untouched';
  end if;

  -- ── 2) a CONSUMED settlement's dead target is cleared, and the goal goes ───
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car')
    returning goal_id into v_goal2;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal2, 'bank', 'investment', '2026-02-01', 50000000)
    returning transaction_id into v_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal2, 'bank', 'investment', '2026-02-02', 20000000)
    returning transaction_id into v_anchor;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal2, 'bank', 'withdrawal', '2026-03-01', 50000000,
          v_src, 50000000, true, v_goal2)
    returning transaction_id into v_settlement;
  -- Merged already: the pool skips consumed rows, so its target is dead metadata.
  update public.investment_transactions
     set consumed_by_inv_id = v_anchor where transaction_id = v_settlement;

  v_result := public.delete_savings_goal(v_goal2);

  if exists (select 1 from public.savings_goals where goal_id = v_goal2) then
    raise exception 'a goal whose merges are all consumed must delete';
  end if;
  select merge_target_goal_id into v_target from public.investment_transactions
   where transaction_id = v_settlement;
  if v_target is not null then
    raise exception 'a consumed settlement''s dead target must be cleared, got %', v_target;
  end if;
  -- History itself survives — only the pointer went.
  if not exists (select 1 from public.investment_transactions
                  where transaction_id = v_settlement and held_for_merge) then
    raise exception 'the settlement row itself must survive';
  end if;

  -- ── 3) parked cash refuses the delete — and rolls back the cleanup with it ─
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Trip')
    returning goal_id into v_goal3;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal3, 'bank', 'investment', '2026-04-01', 30000000)
    returning transaction_id into v_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal3, 'bank', 'investment', '2026-04-02', 10000000)
    returning transaction_id into v_anchor;
  -- One already merged (its target would be cleared) …
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal3, 'bank', 'withdrawal', '2026-05-01', 30000000,
          v_src, 30000000, true, v_goal3)
    returning transaction_id into v_settlement;
  update public.investment_transactions
     set consumed_by_inv_id = v_anchor where transaction_id = v_settlement;
  -- … and one still parked, which is what refuses the delete.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal3, 'bank', 'investment', '2026-04-03', 15000000)
    returning transaction_id into v_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal3, 'bank', 'withdrawal', '2026-05-02', 15000000,
          v_src, 15000000, true, v_goal3);

  begin
    v_result := public.delete_savings_goal(v_goal3);
    raise exception 'parked cash must refuse the delete';
  exception when check_violation then
    v_msg := sqlerrm;
  end;
  if v_msg not like 'delete goal: %parked%' then
    raise exception 'the refusal must name the parked settlement, got %', v_msg;
  end if;
  if not exists (select 1 from public.savings_goals where goal_id = v_goal3) then
    raise exception 'a refused delete must leave the goal in place';
  end if;
  -- The point of the whole issue: the cleanup must not survive the refusal.
  select merge_target_goal_id into v_target from public.investment_transactions
   where transaction_id = v_settlement;
  if v_target is distinct from v_goal3 then
    raise exception 'a refused delete must roll its cleanup back, target is %', v_target;
  end if;

  -- ── 4) a goal that isn't there is distinctly not-found ─────────────────────
  begin
    v_result := public.delete_savings_goal(gen_random_uuid());
    raise exception 'a missing goal must not report success';
  exception when no_data_found then
    v_msg := sqlerrm;
  end;
  if v_msg not like 'delete goal: goal not found%' then
    raise exception 'expected a not-found refusal, got %', v_msg;
  end if;

  raise notice 'delete_savings_goal: single-session cases pass';
end;
$$;

-- ── 5) ownership: another signed-in user cannot delete this goal ─────────────
--
-- The function is security invoker, so RLS is what scopes it. As `authenticated`
-- with someone else's sub, the goal is simply not visible — the same answer a
-- goal that never existed gets, which is the answer that leaks nothing.
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_goal uuid;
  v_msg text;
begin
  insert into auth.users (id, email) values (v_owner, 'delete-goal-owner@test.invalid');
  insert into auth.users (id, email) values (v_intruder, 'delete-goal-intruder@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_owner, 'Mine')
    returning goal_id into v_goal;

  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  begin
    set local role authenticated;
    begin
      perform public.delete_savings_goal(v_goal);
      raise exception 'a foreign goal must not be deletable';
    exception when no_data_found then
      v_msg := sqlerrm;
    end;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_msg not like 'delete goal: goal not found%' then
    raise exception 'expected not-found for a foreign goal, got %', v_msg;
  end if;
  if not exists (select 1 from public.savings_goals where goal_id = v_goal) then
    raise exception 'the owner''s goal must survive';
  end if;

  raise notice 'delete_savings_goal: ownership pass';
end;
$$;

-- ── 6) the real path: the OWNER deletes, as `authenticated`, under RLS ───────
--
-- Every case above ran as postgres, where RLS is off. That proves the logic and
-- not the grants, and the route runs as `authenticated`: the function has to be
-- able to read the count, clear the consumed settlement's dead target and delete
-- the goal through the policies, or this works everywhere except production.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_src uuid;
  v_anchor uuid;
  v_settlement uuid;
  v_result jsonb;
  v_target uuid;
begin
  insert into auth.users (id, email) values (v_user, 'delete-goal-rls@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Boat')
    returning goal_id into v_goal;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 40000000)
    returning transaction_id into v_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-02', 10000000)
    returning transaction_id into v_anchor;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 40000000,
          v_src, 40000000, true, v_goal)
    returning transaction_id into v_settlement;
  update public.investment_transactions
     set consumed_by_inv_id = v_anchor where transaction_id = v_settlement;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  begin
    set local role authenticated;
    v_result := public.delete_savings_goal(v_goal);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- Three transactions carried this goal: the deposit, the anchor and the
  -- settlement. All three move to Unassigned.
  if (v_result ->> 'moved')::int is distinct from 3 then
    raise exception 'expected 3 moved transactions under RLS, got %', v_result;
  end if;
  if exists (select 1 from public.savings_goals where goal_id = v_goal) then
    raise exception 'the owner''s delete must remove the goal';
  end if;
  select merge_target_goal_id into v_target from public.investment_transactions
   where transaction_id = v_settlement;
  if v_target is not null then
    raise exception 'the cleanup must reach the settlement under RLS too, got %', v_target;
  end if;

  raise notice 'delete_savings_goal: authenticated owner pass';
end;
$$;

rollback;
