-- Two withdrawals emptying different tranches of one book, at the same time.
--
-- check_withdrawal_balance locks only the row a withdrawal names as its parent
-- (20260730000002), so two closes against different tranches of the same book
-- never meet. Each unlinker then measured the group on its own snapshot, saw the
-- other tranche's principal as still there, and left the link alone — and both
-- committed, leaving the recurring saving pointing at a book with nothing in it.
-- The invalid state this migration exists to prevent, produced by two writes that
-- are each perfectly legal.
--
-- Run via `npm run test:db` after migrations are applied.

-- ─── Why this file does not roll back ────────────────────────────────────────
--
-- The other files here prove single-session invariants inside `begin` …
-- `rollback`. This one needs TWO sessions that see each other's committed work,
-- so the fixture has to be committed — dblink supplies the connections, and the
-- block cleans up after itself, including on failure, through a connection of its
-- own (a delete issued from here would roll back with the block that failed).
-- Same shape as fund_bucket_assign.test.sql (#610).

create extension if not exists dblink;

-- A leftover from a crashed earlier run would have this run read rows it never
-- wrote. Fixed id, cleared first.
delete from auth.users where id = '66566566-5665-4665-8665-665665665665';

do $$
declare
  c_user   constant uuid := '66566566-5665-4665-8665-665665665665';
  c_book   constant uuid := '66566566-5665-4665-8665-000000000001';
  c_tranche constant uuid := '66566566-5665-4665-8665-000000000002';
  c_saving constant uuid := '66566566-5665-4665-8665-000000000003';
  v_goal   uuid;
  v_conn   text;
  v_rows   int;
  v_link   uuid;
  v_left   bigint;
begin
  v_conn := format('host=%s port=%s dbname=%s user=postgres password=postgres',
                   inet_server_addr(), current_setting('port'), current_database());

  perform dblink_connect('link665_a', v_conn);
  perform dblink_connect('link665_b', v_conn);

  -- ── the fixture, committed so both sessions can see it ────────────────────
  perform dblink_exec('link665_a', format($f$
    insert into auth.users (id, email) values (%L, 'link-close-race@test.invalid');
  $f$, c_user));

  select id into v_goal from dblink('link665_a', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'Sổ tích luỹ') returning goal_id;
  $f$, c_user)) as t(id uuid);

  -- A book of two tranches: the anchor (which the link names) and one more.
  perform dblink_exec('link665_a', format($f$
    insert into public.investment_transactions
      (transaction_id, user_id, goal_id, asset_type, transaction_type,
       investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id)
    values (%L, %L, %L, 'bank', 'investment',
            current_date - 90, current_date + 275, 1000000, 4, %L);
  $f$, c_book, c_user, v_goal, c_book));

  perform dblink_exec('link665_a', format($f$
    insert into public.investment_transactions
      (transaction_id, user_id, goal_id, asset_type, transaction_type,
       investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id)
    values (%L, %L, %L, 'bank', 'investment',
            current_date - 30, current_date + 275, 2000000, 4, %L);
  $f$, c_tranche, c_user, v_goal, c_book));

  perform dblink_exec('link665_a', format($f$
    insert into public.recurring_savings
      (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (%L, %L, %L, 'Gửi góp', 1000000, %L);
  $f$, c_saving, c_user, v_goal, c_book));

  -- ── the race ──────────────────────────────────────────────────────────────
  -- Session A empties the second tranche and holds its transaction open.
  perform dblink_exec('link665_a', 'begin');
  perform dblink_exec('link665_a', format($f$
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
       investment_date, amount_vnd, principal_withdrawn)
    values (%L, %L, 'bank', 'withdrawal', %L, current_date, 2020000, 2000000);
  $f$, c_user, v_goal, c_tranche));

  -- Session B empties the anchor. Sent asynchronously because it MUST block:
  -- serialising on the book is the behaviour under test. Before the fix it did
  -- not block — it measured the group past A's uncommitted withdrawal, found
  -- 2,000,000 still there, and left the link alone.
  perform dblink_send_query('link665_b', format($f$
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
       investment_date, amount_vnd, principal_withdrawn)
    values (%L, %L, 'bank', 'withdrawal', %L, current_date, 1010000, 1000000);
  $f$, c_user, v_goal, c_book));

  -- Long enough for B to reach the lock and queue behind A.
  perform pg_sleep(1);
  perform dblink_exec('link665_a', 'commit');

  select count(*) into v_rows from dblink_get_result('link665_b') as t(ignored text);

  perform dblink_disconnect('link665_a');
  perform dblink_disconnect('link665_b');

  -- ── what must be true afterwards ──────────────────────────────────────────
  -- Both withdrawals stand: neither was refused, and the book is empty.
  select coalesce(sum(
           t.amount_vnd - coalesce((
             select sum(w.principal_withdrawn) from public.investment_transactions w
              where w.parent_transaction_id = t.transaction_id
                and w.transaction_type = 'withdrawal'), 0)
         ), 0)
    into v_left
    from public.investment_transactions t
   where t.deposit_group_id = c_book and t.transaction_type = 'investment';
  if v_left <> 0 then
    raise exception 'the book should have been emptied by both withdrawals, % left', v_left;
  end if;

  select linked_deposit_tx_id into v_link
    from public.recurring_savings where saving_id = c_saving;
  if v_link is not null then
    raise exception 'a book emptied by two concurrent closes must not keep its link';
  end if;

  -- The committed fixture, removed on the way out.
  perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
  raise notice 'recurring_link_close_race: all assertions passed';
exception
  when others then
    -- The fixture is committed, so it outlives a failure here unless it goes now,
    -- and a delete issued from this session would roll back with the block —
    -- hence a fresh connection. Live handles first: they would otherwise survive
    -- as long as this session.
    perform dblink_disconnect(name)
       from unnest(coalesce(dblink_get_connections(), '{}')) as name
      where name like 'link665\_%';
    perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
    raise;
end $$;
