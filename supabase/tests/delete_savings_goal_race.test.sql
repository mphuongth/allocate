-- A settlement cannot be parked into a goal while that goal is being deleted (#687).
--
-- The old route asked "is there cash parked here?" in one request and issued the
-- delete in another, holding nothing in between. Cash parked into the goal in
-- that window landed against a goal the next statement removed — the preflight
-- had already said yes.
--
-- delete_savings_goal takes the goal FOR UPDATE before it asks, and holds it
-- through the delete. enforce_goal_not_completed reads the goal FOR SHARE before
-- any row may point at it, so the parking write has to wait — and what it finds
-- when the lock is granted is a goal that is gone.
--
-- ─── Why this file does not roll back ────────────────────────────────────────
--
-- It needs TWO sessions that see each other's committed work, so the fixture has
-- to be committed. dblink supplies the connections and the block cleans up after
-- itself. Same shape as deposit_book_lock_order.test.sql.
--
-- Run via `npm run test:db` after migrations are applied.

create extension if not exists dblink;

-- A leftover from a crashed earlier run would have this run read rows it never
-- wrote. Fixed id, cleared first.
delete from auth.users where id = '68768768-7687-4687-8687-687687687687';

do $$
declare
  c_user  constant uuid := '68768768-7687-4687-8687-687687687687';
  c_src   constant uuid := '68768768-7687-4687-8687-000000000001';
  v_goal  uuid;
  v_conn  text;
  v_busy  int;
  v_moved int;
  v_left  int;
  v_err   text := null;
begin
  v_conn := format('host=%s port=%s dbname=%s user=postgres password=postgres',
                   inet_server_addr(), current_setting('port'), current_database());

  perform dblink_connect('goal687_deleter', v_conn);
  perform dblink_connect('goal687_parker', v_conn);

  -- ── the fixture, committed so both sessions can see it ────────────────────
  perform dblink_exec('goal687_deleter', format($f$
    insert into auth.users (id, email) values (%L, 'delete-goal-race@test.invalid');
  $f$, c_user));

  select id into v_goal from dblink('goal687_deleter', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'Trip') returning goal_id;
  $f$, c_user)) as t(id uuid);

  -- The deposit a settlement would close. Live and unparked, so the delete's
  -- blocker check finds nothing and gets all the way to the delete.
  perform dblink_exec('goal687_deleter', format($f$
    insert into public.investment_transactions
      (transaction_id, user_id, goal_id, asset_type, transaction_type,
       investment_date, amount_vnd, interest_rate, expiry_date)
    values (%L, %L, %L, 'bank', 'investment', '2026-01-01', 30000000, 5.5, '2027-01-01');
  $f$, c_src, c_user, v_goal));

  -- ── the race ──────────────────────────────────────────────────────────────
  -- The delete runs and holds its lock, uncommitted.
  perform dblink_exec('goal687_deleter', 'begin');
  perform * from dblink('goal687_deleter', format($f$
    select public.delete_savings_goal(%L);
  $f$, v_goal)) as t(result jsonb);

  -- Cash parked into that same goal, from another session. Asynchronous because
  -- it must wait: this is the write that used to slip through the window.
  perform dblink_send_query('goal687_parker', format($f$
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, held_for_merge, merge_target_goal_id)
    values (%L, %L, 'bank', 'withdrawal', '2026-06-01', 30000000, %L, 30000000, true, %L)
    returning transaction_id;
  $f$, c_user, v_goal, c_src, v_goal));

  -- Long enough for it to reach the lock and queue behind the delete.
  perform pg_sleep(1);

  -- The assertion that matters: it is WAITING, not committing. Before the lock
  -- was held across the check and the delete, this write would already be done.
  v_busy := dblink_is_busy('goal687_parker');
  if v_busy <> 1 then
    raise exception 'parking cash must wait for the delete that is holding the goal';
  end if;

  perform dblink_exec('goal687_deleter', 'commit');

  -- Released now — and refused, because the goal it named is gone.
  begin
    perform * from dblink_get_result('goal687_parker') as t(id uuid);
  exception when others then
    v_err := sqlerrm;
  end;
  -- Drain the trailing empty result so the connection is reusable.
  perform * from dblink_get_result('goal687_parker') as t(id uuid);

  if v_err is null then
    raise exception 'parking cash into a deleted goal must be refused, it succeeded';
  end if;

  perform dblink_disconnect('goal687_deleter');
  perform dblink_disconnect('goal687_parker');

  -- ── and the ledger says the same thing ────────────────────────────────────
  if exists (select 1 from public.savings_goals where goal_id = v_goal) then
    raise exception 'the goal should have been deleted';
  end if;
  select count(*) into v_left from public.investment_transactions
   where user_id = c_user and held_for_merge;
  if v_left <> 0 then
    raise exception 'no settlement may survive against a deleted goal, found %', v_left;
  end if;
  -- The deposit itself is still there, moved to Unassigned.
  select count(*) into v_moved from public.investment_transactions
   where user_id = c_user and goal_id is null;
  if v_moved <> 1 then
    raise exception 'the deposit should have moved to Unassigned, got % row(s)', v_moved;
  end if;

  raise notice 'delete_savings_goal race: pass';

exception when others then
  -- Drop the worker sessions FIRST. An assertion that fails between the
  -- deleter's `begin` and its `commit` leaves that session holding the goal, the
  -- user row and the transactions it has already deleted — and the cleanup below
  -- would queue behind those locks forever, hanging the DB suite instead of
  -- reporting the failure that got us here. Disconnecting rolls their open
  -- transactions back and releases everything (measured: the same delete goes
  -- from a lock timeout to succeeding).
  begin perform dblink_disconnect('goal687_deleter'); exception when others then null; end;
  begin perform dblink_disconnect('goal687_parker'); exception when others then null; end;
  -- Then clean up through a connection of this block's own: a delete issued here
  -- would roll back with the block that failed.
  perform dblink_connect('goal687_cleanup', v_conn);
  -- Belt and braces. If anything still holds a lock on the fixture, say so
  -- instead of hanging — a stuck DB job reads as infrastructure, not as this bug.
  perform dblink_exec('goal687_cleanup', 'set lock_timeout = ''10s''');
  perform dblink_exec('goal687_cleanup', format('delete from auth.users where id = %L', c_user));
  perform dblink_disconnect('goal687_cleanup');
  raise;
end;
$$;

-- The fixture was committed, so it has to be removed explicitly.
delete from auth.users where id = '68768768-7687-4687-8687-687687687687';
