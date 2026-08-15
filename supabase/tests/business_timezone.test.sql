-- Business dates in the database are Asia/Ho_Chi_Minh, not the session's zone (#627).
--
-- #591 settled this for TypeScript: the app has exactly ONE business timezone,
-- every "today" comes from lib/dates, and an eslint rule blocks deriving one from
-- UTC or the runtime's local zone. The database was never brought under that rule.
-- `show timezone` on a Supabase stack is UTC, so every `current_date` in a
-- migration was a UTC business date — and between 00:00 and 06:59 Vietnam time
-- the UTC date is still YESTERDAY.
--
-- public.business_today() is the SQL counterpart of todayIso(). This file pins
-- two things:
--
--   • behaviour — the places that derive a business date follow Vietnam, tested
--     by moving the SESSION's zone somewhere extreme and watching them not move;
--   • the invariant — a catalog scan, so a new `current_date` cannot appear in a
--     business-date position without either failing here or being added to the
--     allow-list deliberately.
--
-- now() / CURRENT_TIMESTAMP for created_at / updated_at is correct and untouched:
-- those are instants, not business dates, exactly the distinction the TypeScript
-- rule already makes.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  -- The two session zones the behavioural checks run under. Neither is anywhere
  -- the app runs; that is the point — the answer must not depend on the session.
  --
  -- WHY TWO. 'Etc/GMT+12' is 19 hours behind Vietnam, so its date differs from
  -- the Vietnam date at every hour EXCEPT 19:00–23:59 Vietnam time.
  -- 'Pacific/Kiritimati' is 7 hours ahead, so its date differs from 17:00
  -- onwards. Between them, at least one is always on a different calendar day
  -- than Vietnam — so this file discriminates whatever hour CI happens to run
  -- at, which a single zone cannot promise.
  c_zones constant text[] := array['Etc/GMT+12', 'Pacific/Kiritimati'];

  -- Functions allowed to keep `current_date`, and why. Each of these is the same
  -- shape: `if p_some_date > current_date + 1 then <refuse as future-dated>`.
  --
  -- The + 1 is a TOLERANCE, not a timezone conversion — it was added so a client
  -- a day ahead of the server is not refused outright, and the routes do their
  -- own check through lib/dates with no grace before the call ever gets here.
  -- Under the UTC/Vietnam skew that guard only ever gets STRICTER: between 00:00
  -- and 06:59 Vietnam the session's date is yesterday, so `current_date + 1` is
  -- today and the guard refuses a date it would otherwise have allowed. It never
  -- admits a date it should have refused, which is what a value guard has to
  -- promise.
  --
  -- So they are left alone rather than rewritten: correcting them means
  -- recreating six functions of 65–205 lines each for one token, and a copy
  -- whose next edit does not reach it is how this schema has produced real bugs
  -- (#616's fund-bucket drift). If the slack is ever tightened, that decision
  -- has to move them to business_today() at the same time — this list is where
  -- to look.
  --
  -- Only CODE counts: the scan strips `--` comments first, so a function that
  -- merely discusses the skew (open_successor_book explains why it computes the
  -- Vietnam date itself) is not on this list and must not be added to it.
  c_future_guards constant text[] := array[
    'collapse_accumulating_book',
    'finish_savings_goal',
    'record_recurring_book_topup',
    'renew_term_deposit',
    'renew_term_deposit_with_merge',
    'withdraw_accumulating_book'
  ];

  v_zone     text;
  v_vn       date;
  v_bad      text;
  v_user     uuid;
  v_member   uuid;
  v_goal     uuid;
  v_src      uuid;
  v_saved    date;
  v_row      public.investment_transactions;
  v_kinds    text[];
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'tz@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.insurance_members (user_id, member_name, relationship, annual_payment_vnd)
  values (v_user, 'Mẹ', 'parent', 12000000) returning member_id into v_member;

  -- ── 1) the helper itself ────────────────────────────────────────────────────
  foreach v_zone in array c_zones loop
    perform set_config('TimeZone', v_zone, true);
    v_vn := (now() at time zone 'Asia/Ho_Chi_Minh')::date;

    if public.business_today() is distinct from v_vn then
      raise exception 'business_today() must be the Vietnam date under %, got % want %',
        v_zone, public.business_today(), v_vn;
    end if;

    -- ── 2) the insurance contribution's own date ─────────────────────────────
    -- The route omits saved_date when the client sends none, so the column
    -- default IS the business date for that request — and a contribution filed a
    -- day early lands in the previous cycle, which is what isInCurrentCycle reads.
    insert into public.insurance_savings (user_id, insurance_member_id, amount_saved_vnd)
    values (v_user, v_member, 1000000)
    returning saved_date into v_saved;
    if v_saved is distinct from v_vn then
      raise exception 'an insurance contribution must be dated in Vietnam under %, got % want %',
        v_zone, v_saved, v_vn;
    end if;

    -- ── 3) a held settlement that names no date ──────────────────────────────
    -- Latent rather than live — the only caller passes a validated date — so this
    -- pins the fallback before the next caller finds it.
    insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
    values (v_user, v_goal, 'bank', 'investment', v_vn - 30, 1000000) returning transaction_id into v_src;
    v_row := public.create_held_settlement(v_src, 1000000, null);
    if v_row.investment_date is distinct from v_vn then
      raise exception 'a settlement with no date must be dated in Vietnam under %, got % want %',
        v_zone, v_row.investment_date, v_vn;
    end if;

    -- ── 4) "is this holding still in the future?" ────────────────────────────
    -- A holding dated TODAY in Vietnam is live, not future, so it must not block
    -- finishing the goal. Under a session zone a day behind, current_date called
    -- it future and the goal could not be finished at all.
    insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
    values (v_user, v_goal, 'bank', 'investment', v_vn, 2000000) returning transaction_id into v_src;
    select array_agg(code) into v_kinds from public.savings_goal_finish_blockers(v_goal);
    if 'future_holding' = any(coalesce(v_kinds, '{}')) then
      raise exception 'a holding dated today in Vietnam must not read as future under %', v_zone;
    end if;
    -- And one genuinely in the future still does.
    update public.investment_transactions set investment_date = v_vn + 1 where transaction_id = v_src;
    select array_agg(code) into v_kinds from public.savings_goal_finish_blockers(v_goal);
    if not ('future_holding' = any(coalesce(v_kinds, '{}'))) then
      raise exception 'a holding dated tomorrow must still read as future under %', v_zone;
    end if;
    delete from public.investment_transactions where transaction_id = v_src;
  end loop;
  perform set_config('TimeZone', 'UTC', true);

  -- ── 5) the invariant, as a catalog scan ─────────────────────────────────────
  --
  -- Reading the catalog rather than the migration files: what is installed is
  -- what runs, and a superseded copy in an old migration is not a live rule.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and pg_catalog.regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* '\mcurrent_date\M'
     and not (p.proname = any(c_future_guards));
  if v_bad is not null then
    raise exception 'these functions derive a business date from the session zone — use public.business_today(): %', v_bad;
  end if;

  -- now()::date is the same mistake spelled differently: it takes the session's
  -- zone just as current_date does. `now() at time zone 'Asia/Ho_Chi_Minh'` is
  -- the correct form and does not match.
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and pg_catalog.regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'now\(\)\s*::\s*date';
  if v_bad is not null then
    raise exception 'these functions cast now() to a date in the session zone — use public.business_today(): %', v_bad;
  end if;

  select string_agg(table_name || '.' || column_name, ', ') into v_bad
    from information_schema.columns
   where table_schema = 'public'
     and column_default ~* '\mcurrent_date\M|now\(\)\s*::\s*date';
  if v_bad is not null then
    raise exception 'these column defaults date a row in the session zone — use public.business_today(): %', v_bad;
  end if;

  -- Views and CHECK constraints have no business-date derivation today. Asserted
  -- rather than assumed, because either is a place one could appear without
  -- touching a function.
  select string_agg(viewname, ', ') into v_bad
    from pg_views where schemaname = 'public' and definition ~* '\mcurrent_date\M';
  if v_bad is not null then
    raise exception 'these views derive a business date from the session zone: %', v_bad;
  end if;

  select string_agg(c.conname, ', ') into v_bad
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and pg_get_constraintdef(c.oid) ~* '\mcurrent_date\M';
  if v_bad is not null then
    raise exception 'these constraints derive a business date from the session zone: %', v_bad;
  end if;

  -- ── 6) timestamps are instants and stay untouched ───────────────────────────
  -- The other half of the rule: created_at / updated_at record WHEN something
  -- happened, which has no timezone question in it. If this file ever pushed
  -- them at business_today() it would be replacing an instant with a date.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'investment_transactions'
       and column_name in ('created_at', 'updated_at')
       and column_default ~* 'now\(\)'
       and data_type = 'timestamp with time zone'
  ) then
    raise exception 'created_at / updated_at must stay now() timestamptz instants';
  end if;

  raise notice 'business_timezone.test.sql: OK';
end $$;

rollback;
