-- Covers 20260810000002_drop_fund_nav_source_url.sql — the contract half of the
-- nav_source_url → nav_auto_sync swap. (The expand half has its own test,
-- fund_nav_auto_sync_column.test.sql, which pins the opposite property: that
-- both columns and both overloads coexist.)
--
-- What matters here is that the old side is gone completely and the surviving
-- side behaves. A half-removal is the dangerous outcome: Postgres overloads on
-- argument types, so a leftover nav_source_url overload would stay callable and
-- PostgREST would route any request naming p_nav_source_url to a function
-- writing a dropped column.
--
-- Runs against the local stack; everything happens inside a transaction that is
-- rolled back, so it mutates nothing. Any failed assertion RAISEs and, under
-- `psql -v ON_ERROR_STOP=1`, exits non-zero. Run via `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_on   uuid;
  v_off  uuid;
  v_flag boolean;
  v_is_dca boolean;
begin
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'nav-auto-sync@test.invalid') returning id into v_user;

  -- The RPC is security invoker and filters on auth.uid().
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  insert into funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'Synced Fund', 'DCDS', 'equity', 93915.08, true, 2000000)
    returning id into v_on;

  -- NOT NULL with a false default: a fund created without mentioning the column
  -- is not silently opted into outbound pricing requests.
  select nav_auto_sync into v_flag from funds where id = v_on;
  if v_flag is distinct from false then
    raise exception 'nav_auto_sync must default to false, got %', v_flag;
  end if;

  update funds set nav_auto_sync = true where id = v_on;

  -- nav_source_url must be gone, not merely unused: a retained column that
  -- nothing writes decays into a trap for the next reader.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'funds' and column_name = 'nav_source_url'
  ) then
    raise exception 'nav_source_url should have been dropped';
  end if;

  -- The pre-migration overload must be gone, not left callable beside the new
  -- one. The comparison uses the FULL identity-arguments string, names included:
  -- pg_get_function_identity_arguments returns 'p_fund_id uuid, ...', so an
  -- earlier version of this check that compared against 'uuid, text, ...' could
  -- never match and passed no matter what the database contained.
  if exists (
    select 1
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'disable_fund_dca'
       and pg_get_function_identity_arguments(p.oid)
           = 'p_fund_id uuid, p_name text, p_code text, p_fund_type text, p_nav numeric, p_nav_source_url text'
  ) then
    raise exception 'the nav_source_url overload of disable_fund_dca still exists';
  end if;

  if not exists (
    select 1
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'disable_fund_dca'
       and pg_get_function_identity_arguments(p.oid)
           = 'p_fund_id uuid, p_name text, p_code text, p_fund_type text, p_nav numeric, p_nav_auto_sync boolean'
  ) then
    raise exception 'the nav_auto_sync overload of disable_fund_dca is missing';
  end if;

  -- NULL means "the caller didn't send the flag" → keep the stored setting.
  -- Once the text overload is gone an untyped NULL is unambiguous, but the cast
  -- stays: it is what made this assertion meaningful while both existed, and
  -- removing it would leave the test silently dependent on the drop above.
  perform public.disable_fund_dca(v_on, 'Synced Fund', 'DCDS', 'equity', 93915.08, null::boolean);

  select nav_auto_sync, is_dca into v_flag, v_is_dca from funds where id = v_on;
  if v_flag is not true then
    raise exception 'a partial update must not switch automatic pricing off, got %', v_flag;
  end if;
  if v_is_dca is not false then
    raise exception 'disable_fund_dca must still turn DCA off';
  end if;

  -- An explicit false is honoured — "unchanged" must not swallow a real change.
  perform public.disable_fund_dca(v_on, 'Synced Fund', 'DCDS', 'equity', 93915.08, false);

  select nav_auto_sync into v_flag from funds where id = v_on;
  if v_flag is not false then
    raise exception 'an explicit false must turn automatic pricing off, got %', v_flag;
  end if;

  -- And so is an explicit true, from off.
  insert into funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'Manual Fund', 'MANUAL', 'equity', 10000, true, 1000000)
    returning id into v_off;

  perform public.disable_fund_dca(v_off, 'Manual Fund', 'MANUAL', 'equity', 10000, true);

  select nav_auto_sync into v_flag from funds where id = v_off;
  if v_flag is not true then
    raise exception 'an explicit true must turn automatic pricing on, got %', v_flag;
  end if;

  -- The compatibility trigger goes with the column it existed to mirror. Left
  -- behind it would fire on every insert and force nav_auto_sync off from a
  -- column that no longer exists.
  if exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'funds' and t.tgname = 'funds_sync_nav_auto_sync'
  ) then
    raise exception 'the compatibility trigger funds_sync_nav_auto_sync was not dropped';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'sync_fund_nav_auto_sync'
  ) then
    raise exception 'the compatibility trigger function was not dropped';
  end if;

  -- The expand migration holds funds_updated_at off for its backfill so migrated
  -- funds don't all look freshly repriced. One that disabled a trigger and
  -- failed to re-enable it would silently stop stamping updated_at from then
  -- on — the kind of damage nothing reports.
  if not exists (
    select 1
      from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'funds' and t.tgname = 'funds_updated_at' and t.tgenabled = 'O'
  ) then
    raise exception 'funds_updated_at must be enabled after the migration';
  end if;

  -- And it must still actually fire.
  update funds set updated_at = timestamptz '2020-01-01' where id = v_off;
  if (select updated_at from funds where id = v_off) = timestamptz '2020-01-01' then
    raise exception 'funds_updated_at did not stamp the row';
  end if;

  perform set_config('request.jwt.claims', '', true);

  raise notice 'fund_nav_auto_sync.test.sql: OK';
end $$;

rollback;
