-- Holding a deposit for merge must clear the recurring link atomically (#531).
--
-- Creating a held-for-merge settlement closes its source deposit. If a recurring
-- saving still points at that source via linked_deposit_tx_id, the link now
-- refers to a closed deposit and would try to top it up later.
--
-- The route used to do this as a second statement after the insert, ignore its
-- result, and return 201 either way — so a failed cleanup left a dangling link
-- behind a success response, with no transaction boundary around the pair. An
-- AFTER INSERT trigger runs inside the insert's own transaction, so the two now
-- commit or roll back together by construction.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

-- Used only by step 4, to force the cleanup UPDATE to fail. Rolled back with the
-- rest of the transaction.
--
-- The custom SQLSTATE matters. A bare `raise exception` uses P0001
-- (raise_exception), which is also what step 4's own sentinel raises when the
-- insert unexpectedly SUCCEEDS — so a handler catching P0001 would swallow both.
-- Worse, PL/pgSQL rolls the block back before entering the handler, so the
-- "no settlement row" assertion would then pass too and the step would report
-- success while proving nothing. A distinct code keeps the sentinel escaping.
create or replace function public.tmp_raise_on_update() returns trigger
language plpgsql as $fn$
begin
  raise exception 'forced cleanup failure' using errcode = 'ZZ999';
end;
$fn$;

do $$
declare
  v_user   uuid;
  v_other  uuid;
  v_goal   uuid;
  v_goal2  uuid;
  v_src    uuid;
  v_src2   uuid;
  v_osrc   uuid;
  v_saving uuid;
  v_osav   uuid;
  v_link   uuid;
  v_count  int;
  v_saw_forced_failure boolean := false;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'hold-atomic@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'hold-other@test.invalid') returning id into v_other;

  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Their goal') returning goal_id into v_goal2;

  -- The source deposit a recurring saving feeds.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_src;

  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_user, 'Monthly transfer', v_goal, 5000000, v_src) returning saving_id into v_saving;

  -- A second user with the same shape, to prove the cleanup never reaches across.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_other, v_goal2, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_osrc;

  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_other, 'Theirs', v_goal2, 5000000, v_osrc) returning saving_id into v_osav;

  -- 1) A held settlement on that source clears the link, within the insert itself.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-01', 100000000, v_src, true, v_goal);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then
    raise exception 'holding the source must clear linked_deposit_tx_id, still %', v_link;
  end if;

  -- The other user's identical link is untouched.
  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_osav;
  if v_link is distinct from v_osrc then
    raise exception 'another user''s link must survive, got %', v_link;
  end if;

  -- 2) A PLAIN withdrawal must NOT clear the link — only holding closes the
  --    source for merge. Re-link, then withdraw normally.
  update public.recurring_savings set linked_deposit_tx_id = v_src where saving_id = v_saving;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-02', 10000000, v_src);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is distinct from v_src then
    raise exception 'a plain withdrawal must leave the link intact, got %', v_link;
  end if;

  -- 3) Scoped to the held source: holding a DIFFERENT deposit leaves this alone.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 50000000) returning transaction_id into v_src2;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-03', 50000000, v_src2, true, v_goal);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is distinct from v_src then
    raise exception 'holding an unrelated deposit must not clear this link, got %', v_link;
  end if;

  -- 4) The rollback guarantee. Force the cleanup UPDATE to fail and assert the
  --    settlement insert does not survive it — the exact failure the old
  --    two-statement route turned into a dangling link behind a 201.
  create trigger tmp_break_recurring_update
    before update on public.recurring_savings
    for each row execute function public.tmp_raise_on_update();

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, held_for_merge, merge_target_goal_id)
    values (v_user, v_goal, 'bank', 'withdrawal', '2026-07-04', 100000000, v_src, true, v_goal);
    -- Reached only if the insert survived a failing cleanup. P0001, so the
    -- ZZ999 handler below does NOT catch it: it propagates and fails the test.
    raise exception 'the insert must survive nothing: the cleanup failure did not abort it';
  exception
    when sqlstate 'ZZ999' then
      v_saw_forced_failure := true; -- the cleanup blew up and took the insert with it
  end;

  drop trigger tmp_break_recurring_update on public.recurring_savings;

  -- Belt and braces: assert we actually observed the forced failure rather than
  -- inferring it from the absence of rows, which a rolled-back block also
  -- produces.
  if not v_saw_forced_failure then
    raise exception 'step 4 never observed the forced cleanup failure';
  end if;

  select count(*) into v_count
  from public.investment_transactions
  where user_id = v_user and investment_date = '2026-07-04';
  if v_count <> 0 then
    raise exception 'the settlement must roll back with its cleanup, found % row(s)', v_count;
  end if;

  -- Nothing committed, so the link is exactly as it was.
  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is distinct from v_src then
    raise exception 'a rolled-back hold must leave the link untouched, got %', v_link;
  end if;

  raise notice 'hold_clears_recurring_link.test.sql: OK';
end $$;

rollback;
