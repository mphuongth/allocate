-- Two SECURITY DEFINER paths that told a caller about someone else's rows
-- (#760, #761). Run via `npm run test:db` after migrations are applied.
begin;

-- ── #760: the successor-pairing check is for triggers, not for callers ───────
--
-- It reads a book by id alone, locks it and its successor, and raises errors
-- carrying their dates and state. Its only caller is the definer trigger
-- enforce_successor_book_pairing, which runs as the owner and needs no grant.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_msg text;
begin
  if has_function_privilege('anon', 'public.assert_successor_book_pairing(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.assert_successor_book_pairing(uuid)', 'EXECUTE') then
    raise exception 'end-user roles must not execute assert_successor_book_pairing';
  end if;

  -- And the real path: a signed-in caller going through PostgREST is refused.
  insert into auth.users (id, email) values (v_user, 'pairing-caller@test.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  begin
    set local role authenticated;
    begin
      perform public.assert_successor_book_pairing(gen_random_uuid());
      v_msg := 'called';
    exception when insufficient_privilege then
      v_msg := 'refused';
    end;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_msg <> 'refused' then
    raise exception 'authenticated must not be able to call assert_successor_book_pairing';
  end if;

  raise notice 'assert_successor_book_pairing: not callable pass';
end;
$$;

-- ── #761: a fund's DCA goal check says nothing about another user's goal ─────
--
-- funds_dca_goal_not_completed sorts before funds_fk_ownership, so whatever it
-- says about a foreign goal reaches the caller first. Before the fix it read
-- the goal without a user filter and answered "completed" for a finished one,
-- "deleted" for a missing one and passed an active one through to the
-- ownership error: three answers, each a fact about the other account.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fund uuid;
  v_own_done uuid;
  v_b_done uuid;
  v_b_live uuid;
  v_goal uuid;
  v_msgs text[] := '{}';
  v_msg text;
begin
  insert into auth.users (id, email) values (v_a, 'dca-oracle-a@test.invalid');
  insert into auth.users (id, email) values (v_b, 'dca-oracle-b@test.invalid');
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_a, 'A fund', 'ORCA', 'equity', 20000) returning id into v_fund;
  insert into public.savings_goals (user_id, goal_name) values (v_a, 'A done')
    returning goal_id into v_own_done;
  insert into public.savings_goals (user_id, goal_name) values (v_b, 'B done')
    returning goal_id into v_b_done;
  insert into public.savings_goals (user_id, goal_name) values (v_b, 'B live')
    returning goal_id into v_b_live;
  update public.savings_goals
     set completed_at = now(), completion_value = 1000000, completion_percentage = 100
   where goal_id in (v_own_done, v_b_done);

  -- A points their own fund at each of B's goals, and at a goal that never was.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a::text)::text, true);
  foreach v_goal in array array[v_b_done, v_b_live, gen_random_uuid()] loop
    begin
      set local role authenticated;
      begin
        update public.funds
           set is_dca = true, dca_monthly_amount_vnd = 1000000, dca_goal_id = v_goal
         where id = v_fund;
        v_msg := 'accepted';
      exception when others then
        v_msg := sqlerrm;
      end;
    end;
    reset role;
    v_msgs := v_msgs || v_msg;
  end loop;

  if 'accepted' = any(v_msgs) then
    raise exception 'a fund must not take another user''s goal as its DCA goal: %', v_msgs;
  end if;
  if v_msgs[1] is distinct from v_msgs[2] or v_msgs[2] is distinct from v_msgs[3] then
    raise exception 'a finished, a live and a missing foreign goal must all read the same, got %', v_msgs;
  end if;

  -- The guard itself still works on A's own finished goal.
  begin
    set local role authenticated;
    begin
      update public.funds
         set is_dca = true, dca_monthly_amount_vnd = 1000000, dca_goal_id = v_own_done
       where id = v_fund;
      v_msg := 'accepted';
    exception when check_violation then
      v_msg := sqlerrm;
    end;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_msg not like 'completed goal:%' then
    raise exception 'an own finished goal must still be refused as completed, got %', v_msg;
  end if;

  raise notice 'enforce_goal_not_completed: no foreign-goal oracle pass';
end;
$$;

rollback;
