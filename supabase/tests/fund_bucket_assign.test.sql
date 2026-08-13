-- assign_fund_bucket: what it moves, and what it waits for (#589, #610).
--
-- Two halves, and the file is in two parts to match. The FIRST is what the move
-- is scoped to — the source bucket, the fund, the caller — which one rolled-back
-- session can prove. The SECOND is the race, which needs two sessions and so
-- commits; it is described where it starts.
--
-- Run via `npm run test:db`.

-- ─── Part 1: what one assign moves, and what it leaves alone ────────────────
--
-- The scope used to be a filter chain built in the route, and the #589 bug was a
-- missing link in it: the assign listed the fund with no goal filter, so assigning
-- the Unallocated row dragged rows that already belonged to another goal. The
-- chain now lives in the function, so this is where it is pinned down.
begin;

do $$
declare
  v_user      uuid;
  v_other     uuid;
  v_unalloc   uuid;   -- rows with no goal
  v_goal_a    uuid;
  v_goal_b    uuid;
  v_fund      uuid;
  v_fund_2    uuid;
  v_buy       uuid;
  v_sell      uuid;
  v_seed      uuid;
  v_elsewhere uuid;
  v_foreign   uuid;
  v_moved     uuid[];
  v_msg       text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'assign-scope@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'assign-scope-other@test.invalid') returning id into v_other;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal_a;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car') returning goal_id into v_goal_b;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Scope Fund', 'SCF', 'equity', 20000) returning id into v_fund;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Other Fund', 'OTF', 'equity', 20000) returning id into v_fund_2;

  -- The Unallocated bucket: a purchase, the sale drawn on it, and a pending DCA
  -- seed (a planned amount with no units bought yet).
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, null, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000)
  returning transaction_id into v_buy;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date,
     amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, null, v_fund, 'fund', 'withdrawal', '2026-02-01', 600000, 600000, 30)
  returning transaction_id into v_sell;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, is_dca_seeded)
  values (v_user, null, v_fund, 'fund', 'investment', '2026-03-01', 1000000, true)
  returning transaction_id into v_seed;

  -- Same fund, already in a goal — the rows #589 dragged along.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, v_fund, 'fund', 'investment', '2026-01-01', 400000, 20, 20000)
  returning transaction_id into v_elsewhere;
  -- Another user's Unallocated rows for a fund of their own.
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Theirs');
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_other, null, null, 'bank', 'investment', '2026-01-01', 400000, null, null)
  returning transaction_id into v_foreign;
  -- A different fund of the caller's, also Unallocated.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, null, v_fund_2, 'fund', 'investment', '2026-01-01', 400000, 20, 20000);

  -- The RPC is security invoker and takes its owner from auth.uid(), which reads
  -- this claim. postgres owns the table, so RLS is not in the way and the
  -- function's own user_id filter is what these assertions measure.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  select array_agg(x order by x) into v_moved
    from public.assign_fund_bucket(v_fund, null, v_goal_a) as x;

  -- The purchase AND the sale drawn on it. Moving the purchases alone is the split
  -- this whole pair of issues is about.
  if not (v_buy = any(v_moved) and v_sell = any(v_moved)) then
    raise exception 'the move must carry the bucket whole — purchases and the sales drawn on them (moved %)', v_moved;
  end if;
  if array_length(v_moved, 1) <> 2 then
    raise exception 'exactly the two rows of the source bucket should have moved, moved %', v_moved;
  end if;

  if (select goal_id from public.investment_transactions where transaction_id = v_seed) is not null then
    raise exception 'a pending DCA seed is a plan placeholder, not a holding, and must stay put';
  end if;
  if (select goal_id from public.investment_transactions where transaction_id = v_elsewhere) <> v_goal_b then
    raise exception 'a row already sitting in another goal is not in the source bucket (#589)';
  end if;
  if (select goal_id from public.investment_transactions where transaction_id = v_foreign) is not null then
    raise exception 'another user''s rows are not the caller''s to move';
  end if;
  if (select count(*) from public.investment_transactions
       where user_id = v_user and fund_id = v_fund_2 and goal_id is not null) <> 0 then
    raise exception 'another fund of the caller''s is not in the source bucket';
  end if;

  -- Unassign is the same statement in the other direction, and it takes the sale
  -- back with the purchase.
  perform public.assign_fund_bucket(v_fund, v_goal_a, null);
  if (select count(*) from public.investment_transactions
       where transaction_id in (v_buy, v_sell) and goal_id is null) <> 2 then
    raise exception 'an unassign must return the whole bucket to Unallocated';
  end if;

  -- A move to the bucket it is already in would take the lock and write nothing;
  -- it is a client bug, and it is refused rather than answered with "0 rows moved".
  begin
    perform public.assign_fund_bucket(v_fund, null, null);
    raise exception 'a move whose source and destination are the same must be refused';
  exception when invalid_parameter_value then
    null;
  end;

  -- No claim, no caller: the function must not fall back to moving rows for
  -- whoever happens to be connected.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.assign_fund_bucket(v_fund, null, v_goal_a);
    raise exception 'a sessionless call must be refused';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

rollback;

-- ─── Part 2: an assign and a sell of one bucket must SERIALIZE, not race ─────
--
-- #589 made the assign one scoped UPDATE, which fixed "moves rows it shouldn't".
-- It did not make assign and sell wait for each other, and they contend for the
-- same thing: a sell's BEFORE trigger locks the bucket's purchase rows
-- (20260803000005's check_withdrawal_balance) and an assign moves those same
-- rows. A sell that commits after the assign's statement took its snapshot is
-- invisible to it, so the purchases move and the sale stays behind —
-- lib/withdrawalProgress keys fund rows by (goal_id, fund_id), so the orphaned
-- sale stops offsetting the purchase it belongs to and the sold units come back.
--
-- #587's check_fund_bucket_solvent turned that split into a REFUSED assign, which
-- is the right trade but not the fix: a legitimate move fails with nothing wrong
-- with the input. assign_fund_bucket takes the sell's own row locks, in the sell's
-- own order, BEFORE it moves anything — so the loser waits, and the statement
-- after the wait reads a fresh snapshot containing the winner's committed sale.
--
-- ─── Why this part does not roll back ────────────────────────────────────────
--
-- Part 1 and every other file here run inside `begin` … `rollback`, because one
-- session can prove a single-session invariant. This needs TWO sessions that see
-- each other's committed work, so its fixture has to be committed — dblink
-- supplies the extra connections. The block therefore cleans up after itself,
-- including on failure: the handler deletes the fixture user (everything else
-- cascades) through a fresh dblink connection, because a delete issued from this
-- session would roll back with the block that failed.
--
-- Both extra sessions connect as postgres, which owns the table — so RLS is not in
-- the way, and the claim the assigner sets is what auth.uid() answers. RLS is not
-- what is under test here; the locking is.

create extension if not exists dblink;

-- A leftover from a crashed earlier run would make the assertions read rows this
-- run never wrote. Fixed ids, cleared first.
delete from auth.users where id = '61061061-0610-4610-8610-610610610610';

do $$
declare
  c_user     constant uuid := '61061061-0610-4610-8610-610610610610';
  v_goal_a   uuid;
  v_goal_b   uuid;
  v_fund     uuid;
  v_conn     text;
  v_moved    int;
  v_split    int;
  v_a_rows   int;
  v_b_units  numeric;
  v_b_sold   numeric;
begin
  -- Both sessions come back to this same database, on the port the server itself
  -- is listening on — so the test follows whatever stack psql reached.
  --
  -- Addressed by the server's OWN address rather than 127.0.0.1, and that is not
  -- cosmetic: `postgres` is not a superuser on a Supabase stack, and dblink refuses
  -- a non-superuser connection that did not actually USE a password. The loopback
  -- line in pg_hba is trust, so the password in the string is never consumed there
  -- and the connect fails; the address this session came in on matches the rule
  -- that asks for one.
  v_conn := format('host=%s port=%s dbname=%s user=postgres password=postgres',
                   inet_server_addr(), current_setting('port'), current_database());

  perform dblink_connect('assign610_seller', v_conn);
  perform dblink_connect('assign610_assigner', v_conn);

  -- ── the fixture, committed so both sessions can see it ────────────────────
  -- Written through the seller connection rather than from here: this block's own
  -- inserts stay uncommitted until it ends, and the other session would find an
  -- empty bucket and prove nothing.
  perform dblink_exec('assign610_seller', format($f$
    insert into auth.users (id, email) values (%L, 'assign-serialized@test.invalid');
  $f$, c_user));

  select id into v_goal_a from dblink('assign610_seller', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'House') returning goal_id;
  $f$, c_user)) as t(id uuid);

  select id into v_goal_b from dblink('assign610_seller', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'Car') returning goal_id;
  $f$, c_user)) as t(id uuid);

  select id into v_fund from dblink('assign610_seller', format($f$
    insert into public.funds (user_id, name, code, fund_type, nav)
    values (%L, 'Race Fund', 'RCF', 'equity', 20000) returning id;
  $f$, c_user)) as t(id uuid);

  perform dblink_exec('assign610_seller', format($f$
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
    values (%L, %L, %L, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000);
  $f$, c_user, v_goal_a, v_fund));

  -- The RPC is security invoker and reads auth.uid(), so the caller's session
  -- carries the claim PostgREST would have put there.
  perform dblink_exec('assign610_assigner', format($f$
    set "request.jwt.claims" = %L;
  $f$, json_build_object('sub', c_user::text)::text));

  -- ── the race ──────────────────────────────────────────────────────────────
  -- Session 1 sells 30 of goal A's 100 units and holds its transaction open, so it
  -- is still holding the row locks the sell took on that bucket's purchases.
  perform dblink_exec('assign610_seller', 'begin');
  perform dblink_exec('assign610_seller', format($f$
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date,
       amount_vnd, principal_withdrawn, units_withdrawn)
    values (%L, %L, %L, 'fund', 'withdrawal', '2026-02-01', 600000, 600000, 30);
  $f$, c_user, v_goal_a, v_fund));

  -- Session 2 moves the whole bucket to goal B. Sent asynchronously because it MUST
  -- block — that is the behaviour under test. Before the fix it did not block: it
  -- ran past the uncommitted sale, and was then refused by the bucket-solvency
  -- check (or, with that check absent, split the bucket in silence).
  perform dblink_send_query('assign610_assigner', format($f$
    select * from public.assign_fund_bucket(%L, %L, %L);
  $f$, v_fund, v_goal_a, v_goal_b));

  -- Long enough for the assign to reach the lock and queue behind the seller.
  perform pg_sleep(1);

  perform dblink_exec('assign610_seller', 'commit');

  -- Raises here if the assign was refused, which is the pre-fix outcome.
  select count(*) into v_moved
    from dblink_get_result('assign610_assigner') as t(transaction_id uuid);

  perform dblink_disconnect('assign610_seller');
  perform dblink_disconnect('assign610_assigner');

  -- ── what must be true afterwards ──────────────────────────────────────────
  -- The invariant first, and without naming a winner: no (goal_id, fund_id) bucket
  -- may be left holding sales its purchases cannot back.
  select count(*) into v_split
    from (
      select w.goal_id, coalesce(sum(w.units_withdrawn), 0) as sold,
             (select coalesce(sum(p.units), 0)
                from public.investment_transactions p
               where p.user_id = c_user and p.fund_id = v_fund and p.asset_type = 'fund'
                 and p.transaction_type = 'investment'
                 and p.goal_id is not distinct from w.goal_id) as held
        from public.investment_transactions w
       where w.user_id = c_user and w.fund_id = v_fund and w.asset_type = 'fund'
         and w.transaction_type = 'withdrawal'
       group by w.goal_id
    ) b
   where b.sold > b.held;

  if v_split > 0 then
    raise exception 'the bucket was split: % goal bucket(s) hold sales their purchases cannot back', v_split;
  end if;

  -- And the assign must have SUCCEEDED. The solvency mitigation also leaves the
  -- invariant intact — by failing a move that was never invalid — so asserting the
  -- invariant alone would pass without the lock. Both rows moved: the purchase, and
  -- the sale that committed while the assign was waiting for it.
  if v_moved <> 2 then
    raise exception 'the assign should have waited for the sell and moved both rows, moved % row(s)', v_moved;
  end if;

  select count(*) into v_a_rows
    from public.investment_transactions
   where user_id = c_user and fund_id = v_fund and goal_id = v_goal_a;
  if v_a_rows <> 0 then
    raise exception 'goal A should have been emptied, % row(s) left behind', v_a_rows;
  end if;

  select coalesce(sum(units), 0), coalesce(sum(units_withdrawn), 0)
    into v_b_units, v_b_sold
    from public.investment_transactions
   where user_id = c_user and fund_id = v_fund and goal_id = v_goal_b;
  if v_b_units <> 100 or v_b_sold <> 30 then
    raise exception 'goal B should hold the whole bucket (100 units bought, 30 sold), got % / %',
      v_b_units, v_b_sold;
  end if;

  -- The committed fixture, removed on the way out.
  perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
exception
  when others then
    -- The fixture outlives a failure unless it goes now, and a delete issued from
    -- this session would roll back with the block — hence a fresh connection.
    -- Live handles first: they would otherwise survive as long as this session.
    perform dblink_disconnect(name)
       from unnest(coalesce(dblink_get_connections(), '{}')) as name
      where name like 'assign610\_%';
    perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
    raise;
end;
$$;
