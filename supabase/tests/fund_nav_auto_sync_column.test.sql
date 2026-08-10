-- Covers 20260810000001_add_fund_nav_auto_sync.sql — the expand half of the
-- nav_source_url → nav_auto_sync swap.
--
-- The property under test is compatibility: this migration must be invisible to
-- the code currently in production. It runs about six minutes before the code
-- that needs it (Vercel deploys first; the migrate job waits on every CI gate),
-- and the release after it drops the old column, so anything here that breaks
-- the old shape breaks production in the gap.
--
-- Runs against the local stack; everything happens inside a transaction that is
-- rolled back, so it mutates nothing. Any failed assertion RAISEs and, under
-- `psql -v ON_ERROR_STOP=1`, exits non-zero. Run via `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_fund uuid;
  v_flag boolean;
  v_url  text;
  v_is_dca boolean;
begin
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'nav-auto-sync-column@test.invalid') returning id into v_user;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  -- Both columns coexist through the changeover. Losing either one strands a
  -- deployment: the old code reads nav_source_url, the new code nav_auto_sync.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'funds' and column_name = 'nav_source_url'
  ) then
    raise exception 'nav_source_url must survive this migration — the old code still reads it';
  end if;

  insert into funds (user_id, name, code, fund_type, nav, is_dca, dca_monthly_amount_vnd)
    values (v_user, 'Fund', 'DCDS', 'equity', 93915.08, true, 2000000)
    returning id into v_fund;

  -- NOT NULL with a false default: a fund created without mentioning the column
  -- is not silently opted into outbound pricing requests.
  select nav_auto_sync into v_flag from funds where id = v_fund;
  if v_flag is distinct from false then
    raise exception 'nav_auto_sync must default to false, got %', v_flag;
  end if;

  -- BOTH overloads of disable_fund_dca must be callable. The old one is what
  -- production is calling right now; the new one is what the next release calls.
  -- Postgres overloads on argument types and PostgREST selects by argument name,
  -- so the two coexist without ambiguity.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'disable_fund_dca'
       and pg_get_function_identity_arguments(p.oid) = 'p_fund_id uuid, p_name text, p_code text, p_fund_type text, p_nav numeric, p_nav_source_url text'
  ) then
    raise exception 'the nav_source_url overload must remain for the code still in production';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'disable_fund_dca'
       and pg_get_function_identity_arguments(p.oid) = 'p_fund_id uuid, p_name text, p_code text, p_fund_type text, p_nav numeric, p_nav_auto_sync boolean'
  ) then
    raise exception 'the nav_auto_sync overload was not created';
  end if;

  -- The new overload: NULL means "flag not sent" → keep the stored value. A
  -- partial write must not switch automatic pricing off behind the user, and the
  -- column is NOT NULL so a bare assignment would fail the write outright.
  --
  -- The cast is load-bearing while both overloads exist. An untyped NULL resolves
  -- to the TEXT one — measured: it nulls nav_source_url and never touches
  -- nav_auto_sync, so this assertion would pass without the boolean overload
  -- being called at all.
  -- nav_source_url is given a value first precisely so the wrong overload would
  -- be visible: the text one would null it.
  update funds set nav_auto_sync = true, nav_source_url = 'https://www.vcbf.com/keep' where id = v_fund;
  perform public.disable_fund_dca(v_fund, 'Fund', 'DCDS', 'equity', 93915.08, null::boolean);

  select nav_auto_sync, is_dca, nav_source_url into v_flag, v_is_dca, v_url from funds where id = v_fund;
  if v_flag is not true then
    raise exception 'a partial update must not switch automatic pricing off, got %', v_flag;
  end if;
  if v_is_dca is not false then
    raise exception 'disable_fund_dca must still turn DCA off';
  end if;
  -- Proves the boolean overload is the one that ran: the text overload would
  -- have written nav_source_url. Without this the assertion above is satisfied
  -- by the wrong function.
  if v_url is distinct from 'https://www.vcbf.com/keep' then
    raise exception 'the text overload ran instead of the boolean one (nav_source_url = %)', coalesce(v_url, 'NULL');
  end if;

  -- An explicit value is honoured — "unchanged" must not swallow a real change.
  perform public.disable_fund_dca(v_fund, 'Fund', 'DCDS', 'equity', 93915.08, false);
  select nav_auto_sync into v_flag from funds where id = v_fund;
  if v_flag is not false then
    raise exception 'an explicit false must turn automatic pricing off, got %', v_flag;
  end if;

  -- The old overload still writes the old column, untouched by any of this.
  perform public.disable_fund_dca(v_fund, 'Fund', 'DCDS', 'equity', 93915.08, 'https://www.vcbf.com/x');
  select nav_source_url into v_url from funds where id = v_fund;
  if v_url is distinct from 'https://www.vcbf.com/x' then
    raise exception 'the old overload must still write nav_source_url, got %', v_url;
  end if;

  -- The backfill disables funds_updated_at so migrated funds don't all look
  -- freshly repriced. A migration that disabled a trigger and failed to restore
  -- it would silently stop stamping updated_at from then on — nothing reports it.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'funds' and t.tgname = 'funds_updated_at' and t.tgenabled = 'O'
  ) then
    raise exception 'funds_updated_at must be enabled after the migration';
  end if;

  update funds set updated_at = timestamptz '2020-01-01' where id = v_fund;
  if (select updated_at from funds where id = v_fund) = timestamptz '2020-01-01' then
    raise exception 'funds_updated_at did not stamp the row';
  end if;

  -- The reconciliation the contract migration will run, pinned here because this
  -- is the last release in which it can be checked: once nav_source_url is
  -- dropped there is nothing left to derive the flag from.
  --
  -- It has to work in BOTH directions. A one-way `set nav_auto_sync = true where
  -- nav_source_url is not null` repairs a fund opted in during the compatibility
  -- window but leaves one opted *out* still flagged true, switching that user's
  -- automatic pricing back on behind them. Measured: under the one-way form the
  -- opted-out row below stays true.
  declare
    v_opted_in  uuid;
    v_opted_out uuid;
  begin
    -- Opted in by the old release after the backfill: URL set, flag still default.
    insert into funds (user_id, name, code, fund_type, nav, nav_source_url, nav_auto_sync)
      values (v_user, 'Opted In', 'RECIN', 'equity', 1000, 'https://www.vcbf.com/in', false)
      returning id into v_opted_in;

    -- Opted out by the old release after the backfill: URL cleared, flag stale.
    insert into funds (user_id, name, code, fund_type, nav, nav_source_url, nav_auto_sync)
      values (v_user, 'Opted Out', 'RECOUT', 'equity', 1000, null, true)
      returning id into v_opted_out;

    update public.funds
       set nav_auto_sync = (nav_source_url is not null)
     where nav_auto_sync is distinct from (nav_source_url is not null);

    if (select nav_auto_sync from funds where id = v_opted_in) is not true then
      raise exception 'reconciliation must opt in a fund that gained a source URL';
    end if;
    if (select nav_auto_sync from funds where id = v_opted_out) is not false then
      raise exception 'reconciliation must opt out a fund whose source URL was cleared';
    end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  raise notice 'fund_nav_auto_sync_column.test.sql: OK';
end $$;

rollback;
