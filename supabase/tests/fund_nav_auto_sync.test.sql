-- Covers 20260807000001_fund_nav_auto_sync_flag.sql.
--
-- funds.nav_auto_sync replaced funds.nav_source_url as the per-fund opt-in for
-- automatic NAV pricing. The interesting part is not the column but how
-- disable_fund_dca writes it: the RPC updates the whole fund config in one
-- statement, so a caller that doesn't send the flag must leave it alone. The
-- column is NOT NULL, so a bare `nav_auto_sync = p_nav_auto_sync` would either
-- fail the write or silently switch someone's pricing off — the #590 shape,
-- where a write wipes configuration the user never touched.
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

  -- The column exists, is NOT NULL, and defaults to off: a fund created without
  -- mentioning it is not silently opted into outbound pricing requests.
  insert into funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'Synced Fund', 'DCDS', 'equity', 93915.08, true, 2000000)
    returning id into v_on;

  select nav_auto_sync into v_flag from funds where id = v_on;
  if v_flag is distinct from false then
    raise exception 'nav_auto_sync must default to false, got %', v_flag;
  end if;

  update funds set nav_auto_sync = true where id = v_on;

  -- nav_source_url must be gone, not merely unused: a retained column that
  -- nothing writes is what this migration existed to remove.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'funds' and column_name = 'nav_source_url'
  ) then
    raise exception 'nav_source_url should have been dropped';
  end if;

  -- NULL means "the caller didn't send the flag" → keep the stored setting.
  perform public.disable_fund_dca(v_on, 'Synced Fund', 'DCDS', 'equity', 93915.08, null);

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

  -- The pre-migration overload must be gone, not left callable beside the new
  -- one: Postgres overloads on argument types, so a stale six-text signature
  -- would keep accepting writes that set the flag from a URL string.
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'disable_fund_dca'
       and pg_get_function_identity_arguments(p.oid) = 'uuid, text, text, text, numeric, text'
  ) then
    raise exception 'the old disable_fund_dca(uuid,text,text,text,numeric,text) overload still exists';
  end if;

  -- The backfill disables funds_updated_at so migrated funds don't all appear
  -- freshly repriced (the views render NAV age from updated_at). A migration
  -- that disabled a trigger and failed to re-enable it would silently stop
  -- stamping updated_at from then on — the kind of damage nothing reports.
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
