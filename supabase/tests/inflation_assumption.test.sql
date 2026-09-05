-- The inflation assumption is the user's own, and the app never edits it for
-- them (20260905000001).
--
-- Two things have to hold for the feature to be honest. The rate is a planning
-- position, so one user's must be invisible to another — it is stored per user
-- and read on every goal card. And NULL must survive as its own answer: the
-- column distinguishes "I have not chosen" (NULL, answered with the app default)
-- from "assume no inflation" (0, a position the app must keep). A NOT NULL
-- DEFAULT 4 would collapse those two into one and silently attribute an
-- assumption to a user who never made it.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_owner    uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_goal     uuid;
  v_seen     int;
  v_rate     numeric;
  v_failed   boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'inflation-owner@test.invalid');
  insert into auth.users (id, email) values (v_intruder, 'inflation-intruder@test.invalid');

  insert into public.user_settings (user_id, inflation_rate_pct) values (v_owner, 4.5);

  -- ── A rate is not chosen until the user chooses it ──────────────────────────
  insert into public.user_settings (user_id) values (v_intruder);
  select inflation_rate_pct into v_rate from public.user_settings where user_id = v_intruder;
  if v_rate is not null then
    raise exception 'a row with no rate set must read as NULL, got %', v_rate;
  end if;

  -- ── Zero is a position, not an absence ─────────────────────────────────────
  update public.user_settings set inflation_rate_pct = 0 where user_id = v_intruder;
  select inflation_rate_pct into v_rate from public.user_settings where user_id = v_intruder;
  if v_rate is null or v_rate <> 0 then
    raise exception 'an explicit 0 must survive as 0, got %', v_rate;
  end if;

  -- ── Nonsense rates are refused ─────────────────────────────────────────────
  v_failed := false;
  begin
    update public.user_settings set inflation_rate_pct = 150 where user_id = v_intruder;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a rate above 100%% must be refused';
  end if;

  v_failed := false;
  begin
    update public.user_settings set inflation_rate_pct = -1 where user_id = v_intruder;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a negative rate must be refused';
  end if;

  -- ── One user's assumption is invisible to another ──────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  begin
    set local role authenticated;
    select count(*) into v_seen from public.user_settings where user_id = v_owner;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_seen <> 0 then
    raise exception 'a foreign inflation rate must not be readable, saw % row(s)', v_seen;
  end if;

  -- ── A goal starts with no override, and takes one when given ───────────────
  insert into public.savings_goals (user_id, goal_name, target_amount, target_date)
  values (v_owner, 'Tuition', 500000000, '2030-06')
  returning goal_id into v_goal;

  select inflation_rate_pct into v_rate from public.savings_goals where goal_id = v_goal;
  if v_rate is not null then
    raise exception 'a new goal must default to the user rate (NULL override), got %', v_rate;
  end if;

  -- Tuition does not track the general basket; the override is the point.
  update public.savings_goals set inflation_rate_pct = 9 where goal_id = v_goal;
  select inflation_rate_pct into v_rate from public.savings_goals where goal_id = v_goal;
  if v_rate <> 9 then
    raise exception 'a per-goal override must be stored, got %', v_rate;
  end if;

  v_failed := false;
  begin
    update public.savings_goals set inflation_rate_pct = -5 where goal_id = v_goal;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a negative per-goal override must be refused';
  end if;

  -- ── The assumption leaves with its user ────────────────────────────────────
  delete from auth.users where id = v_intruder;
  if exists (select 1 from public.user_settings where user_id = v_intruder) then
    raise exception 'settings must cascade when the user is deleted';
  end if;

  raise notice 'inflation assumption: pass';
end $$;

rollback;
