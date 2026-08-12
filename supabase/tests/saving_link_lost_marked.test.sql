-- Deleting a deposit must leave a mark on the recurring saving it was funding (#655).
--
-- `linked_deposit_tx_id` is ON DELETE SET NULL, so deleting the deposit unlinks
-- the saving and says nothing. The plan then stops routing money into a book
-- while still showing a green monthly line — the silence is the bug, not the
-- unlink. `unlinked_at` records that the link was taken away rather than given
-- up, which is the only thing that distinguishes this from the many savings that
-- were never linked to anything.
--
-- Scope is exactly a deposit deletion. A user who clears the link themselves has
-- said what they want, and must not be nagged about it.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user     uuid;
  v_other    uuid;
  v_goal     uuid;
  v_goal2    uuid;
  v_dep      uuid;
  v_dep2     uuid;
  v_odep     uuid;
  v_saving   uuid;
  v_other_s  uuid;
  v_osav     uuid;
  v_link     uuid;
  v_at       timestamptz;
  v_at_count int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'unlink-mark@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'unlink-other@test.invalid') returning id into v_other;

  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Their goal') returning goal_id into v_goal2;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_dep;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 50000000) returning transaction_id into v_dep2;

  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_user, 'Monthly transfer', v_goal, 5000000, v_dep) returning saving_id into v_saving;
  -- A sibling linked elsewhere, to prove the mark lands on the right saving only.
  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_user, 'Other transfer', v_goal, 3000000, v_dep2) returning saving_id into v_other_s;

  -- Another user with the same shape: the mark must never reach across owners.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_other, v_goal2, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_odep;
  insert into public.recurring_savings (user_id, name, goal_id, amount_vnd, linked_deposit_tx_id)
  values (v_other, 'Theirs', v_goal2, 5000000, v_odep) returning saving_id into v_osav;

  -- A saving nobody has touched carries no mark.
  select unlinked_at into v_at from public.recurring_savings where saving_id = v_saving;
  if v_at is not null then
    raise exception 'a live link must carry no mark, got %', v_at;
  end if;

  -- 1) Deleting the linked deposit unlinks the saving AND records that it happened.
  delete from public.investment_transactions where transaction_id = v_dep;

  select linked_deposit_tx_id, unlinked_at into v_link, v_at
    from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then
    raise exception 'deleting the deposit must clear the link, still %', v_link;
  end if;
  if v_at is null then
    raise exception 'deleting the deposit must stamp unlinked_at';
  end if;

  -- 2) The sibling and the other user are untouched.
  select linked_deposit_tx_id, unlinked_at into v_link, v_at
    from public.recurring_savings where saving_id = v_other_s;
  if v_link is distinct from v_dep2 or v_at is not null then
    raise exception 'an unrelated saving must be untouched, link % mark %', v_link, v_at;
  end if;

  select linked_deposit_tx_id, unlinked_at into v_link, v_at
    from public.recurring_savings where saving_id = v_osav;
  if v_link is distinct from v_odep or v_at is not null then
    raise exception 'another user''s saving must be untouched, link % mark %', v_link, v_at;
  end if;

  -- 3) Re-linking answers the warning, so the mark goes.
  update public.recurring_savings set linked_deposit_tx_id = v_dep2 where saving_id = v_saving;
  select unlinked_at into v_at from public.recurring_savings where saving_id = v_saving;
  if v_at is not null then
    raise exception 're-linking must clear the mark, got %', v_at;
  end if;

  -- 4) A link the user gives up themselves is a decision, not a loss: no mark.
  update public.recurring_savings set linked_deposit_tx_id = null where saving_id = v_saving;
  select unlinked_at into v_at from public.recurring_savings where saving_id = v_saving;
  if v_at is not null then
    raise exception 'clearing the link by hand must not mark it, got %', v_at;
  end if;

  -- 5) Deleting the account must still work. Both tables cascade, so the saving
  --    the mark would land on is on its way out too — writing to it re-checks an
  --    owner that the same cascade has already removed, and an advisory flag must
  --    never be the thing that blocks an account deletion.
  update public.recurring_savings set linked_deposit_tx_id = v_dep2 where saving_id = v_saving;
  delete from auth.users where id = v_user;

  select count(*) into v_at_count from public.recurring_savings where user_id = v_user;
  if v_at_count <> 0 then
    raise exception 'deleting the account must take its savings with it, % left', v_at_count;
  end if;

  raise notice 'saving_link_lost_marked.test.sql: OK';
end $$;

rollback;
