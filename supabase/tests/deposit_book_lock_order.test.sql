-- update_deposit_book takes its group in a defined order (#653).
--
-- The RPC locked the tranche it was handed, then rewrote the whole group in one
-- unordered statement:
--
--   update public.investment_transactions … where deposit_group_id = v_group;
--
-- A bare UPDATE locks rows as the plan returns them, which is physical order —
-- so the group's locks were acquired in whatever order the rows happen to sit in.
-- That is a deadlock edge against anything taking the same rows in a defined one,
-- and merge_book_into_successor (#649) was moved to a single ordered acquisition
-- precisely to remove ITS half of that cycle. Half a cycle removed is not a cycle
-- removed: two concurrent edits of one book can still invert against each other,
-- and the result surfaces as a raw 40P01 behind a generic 500.
--
-- ── how this is measured ─────────────────────────────────────────────────────
--
-- A deadlock itself is not a deterministic thing to test — reproducing one needs
-- two plans to disagree about order, which on a two-row table they will not do to
-- order. What IS deterministic is the property that removes the edge: the whole
-- group is locked, in transaction_id order, BEFORE anything is written.
--
-- So the fixture is built with physical order deliberately opposite to id order —
-- the anchor (id 2222…) is inserted first, the tranche (id 1111…) second — and
-- then:
--
--   • session A locks the LOWEST id (1111…) and holds it;
--   • session B calls the RPC naming the OTHER row (2222…), so its own
--     single-row lock is not what makes it wait;
--   • while B waits, A asks for 2222… with NOWAIT.
--
-- Before the fix, B has already locked and written 2222… on the way to 1111…
-- (physical order), so A's probe is refused. After it, B is queued at the ordered
-- acquisition with nothing taken past 1111…, so the probe succeeds. Then A
-- commits and B's edit lands whole, which is the other half of the assertion:
-- ordering must not cost the serialization.
--
-- ── why this file does not roll back ─────────────────────────────────────────
--
-- Two sessions must see each other's committed work, so the fixture is committed
-- and the block cleans up after itself — including on failure, through a fresh
-- connection, since a delete issued from this session would roll back with it.
-- Same shape as fund_bucket_assign.test.sql part 2 (#610).

create extension if not exists dblink;

-- A leftover from a crashed earlier run would make the assertions read rows this
-- run never wrote. Fixed ids, cleared first.
delete from auth.users where id = '65365365-3653-4653-8653-653653653653';

do $$
declare
  c_user    constant uuid := '65365365-3653-4653-8653-653653653653';
  -- Chosen, not generated: the test needs id order and physical order to
  -- disagree, so it has to know which is which.
  c_anchor  constant uuid := '22222222-2222-4222-8222-222222222222';
  c_tranche constant uuid := '11111111-1111-4111-8111-111111111111';
  v_goal_a  uuid;
  v_goal_b  uuid;
  v_conn    text;
  v_probe   int;
  v_moved   int;
  v_edited  uuid;
begin
  v_conn := format('host=%s port=%s dbname=%s user=postgres password=postgres',
                   inet_server_addr(), current_setting('port'), current_database());

  perform dblink_connect('book653_holder', v_conn);
  perform dblink_connect('book653_editor', v_conn);

  -- ── the fixture, committed so both sessions can see it ────────────────────
  perform dblink_exec('book653_holder', format($f$
    insert into auth.users (id, email) values (%L, 'book-lock-order@test.invalid');
  $f$, c_user));

  select id into v_goal_a from dblink('book653_holder', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'House') returning goal_id;
  $f$, c_user)) as t(id uuid);

  select id into v_goal_b from dblink('book653_holder', format($f$
    insert into public.savings_goals (user_id, goal_name) values (%L, 'Car') returning goal_id;
  $f$, c_user)) as t(id uuid);

  -- The anchor FIRST — physical order is insertion order on a table this small,
  -- and it must be the opposite of id order for the probe below to mean anything.
  perform dblink_exec('book653_holder', format($f$
    insert into public.investment_transactions
      (transaction_id, user_id, goal_id, asset_type, transaction_type, investment_date,
       amount_vnd, interest_rate, expiry_date, deposit_group_id)
    values (%L, %L, %L, 'bank', 'investment', '2026-01-01', 10000000, 5.5, '2027-01-01', %L);
  $f$, c_anchor, c_user, v_goal_a, c_anchor));

  perform dblink_exec('book653_holder', format($f$
    insert into public.investment_transactions
      (transaction_id, user_id, goal_id, asset_type, transaction_type, investment_date,
       amount_vnd, interest_rate, expiry_date, deposit_group_id)
    values (%L, %L, %L, 'bank', 'investment', '2026-02-01', 20000000, 5.5, '2027-01-01', %L);
  $f$, c_tranche, c_user, v_goal_a, c_anchor));

  -- ── the race ──────────────────────────────────────────────────────────────
  -- A holds the lowest id and nothing else.
  perform dblink_exec('book653_holder', 'begin');
  perform * from dblink('book653_holder', format($f$
    select transaction_id from public.investment_transactions
     where transaction_id = %L for update;
  $f$, c_tranche)) as t(id uuid);

  -- B edits the book, naming the OTHER row. Asynchronous because it must wait.
  perform dblink_send_query('book653_editor', format($f$
    select transaction_id from public.update_deposit_book(
      %L, true, %L, false, null, false, null, false, null, false, null, false, null
    );
  $f$, c_anchor, v_goal_b));

  -- Long enough for B to reach the lock and queue behind A.
  perform pg_sleep(1);

  -- The probe. NOWAIT so it answers instead of joining the queue — a refusal is
  -- the pre-fix outcome and has to be reported as this rule, not as a raw
  -- lock error from a nested connection.
  begin
    select count(*) into v_probe
      from dblink('book653_holder', format($f$
        select transaction_id from public.investment_transactions
         where transaction_id = %L for update nowait;
      $f$, c_anchor)) as t(id uuid);
  exception when others then
    raise exception 'the anchor must be free while the editor waits: the group is being locked in plan order, not id order (%)', sqlerrm;
  end;
  if v_probe <> 1 then
    raise exception 'the anchor should have been free while the editor waited';
  end if;

  perform dblink_exec('book653_holder', 'commit');

  select count(*) into v_moved
    from dblink_get_result('book653_editor') as t(id uuid);
  if v_moved <> 1 then
    raise exception 'the edit should have completed once the holder committed, got % row(s)', v_moved;
  end if;

  perform dblink_disconnect('book653_holder');
  perform dblink_disconnect('book653_editor');

  -- ── and the edit still cascades whole ─────────────────────────────────────
  -- Ordering the acquisition must not cost what the RPC exists for: a book-level
  -- field moves every tranche, not the row that was named.
  select count(*) into v_moved
    from public.investment_transactions
   where user_id = c_user and deposit_group_id = c_anchor and goal_id = v_goal_b;
  if v_moved <> 2 then
    raise exception 'the whole book should have moved to the new goal, % row(s) did', v_moved;
  end if;

  select goal_id into v_edited
    from public.investment_transactions where transaction_id = c_tranche;
  if v_edited is distinct from v_goal_b then
    raise exception 'the tranche the caller did not name must move with its book';
  end if;

  perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
exception
  when others then
    perform dblink_disconnect(name)
       from unnest(coalesce(dblink_get_connections(), '{}')) as name
      where name like 'book653\_%';
    perform dblink_exec(v_conn, format('delete from auth.users where id = %L', c_user));
    raise;
end;
$$;
