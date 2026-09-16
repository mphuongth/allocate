-- The monthly savings challenge: pick a tier for the month, then tick off one
-- day at a time (20260916000001).
--
-- The feature is a tracker — no transaction, no book, no goal — so the database
-- is the only thing standing between the user and a challenge that quietly
-- rewrites itself. Four promises have to hold here rather than in the route,
-- because each of them is a statement about rows that already exist:
--
--   1. One challenge per user per month. Two rows for September would give the
--      month two different daily schedules and no way to say which is real.
--   2. The tier locks the moment the first day is ticked. That is the whole
--      point of the feature — a challenge you can downgrade in week three is not
--      a challenge — and it has to be a row-level rule, since the decision it
--      guards is "has anything been ticked yet", which only the database knows
--      for certain under concurrency.
--   3. A day's amount is derived, never asserted. The row stores the number so
--      the history survives a later change to the formula, but the trigger
--      recomputes it and refuses a value that disagrees. A stored amount nobody
--      checks is how a tracker starts lying about its own total.
--   4. A day has to exist in its month. Day 31 of a 30-day month, or day 30 of
--      February, is not a day the user can set money aside on.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_owner    uuid := gen_random_uuid();
  v_intruder uuid := gen_random_uuid();
  v_sep      uuid;  -- September 2026 — 30 days
  v_oct      uuid;  -- October 2026 — 31 days
  v_feb      uuid;  -- February 2027 — 28 days
  v_amount   bigint;
  v_tier     smallint;
  v_seen     int;
  v_failed   boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'challenge-owner@test.invalid');
  insert into auth.users (id, email) values (v_intruder, 'challenge-intruder@test.invalid');

  -- ── A month takes exactly one challenge ────────────────────────────────────
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 9, 1) returning challenge_id into v_sep;

  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month, tier)
    values (v_owner, 2026, 9, 2);
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a second challenge for the same month must be refused';
  end if;

  -- ...but the same month belongs to each user separately.
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_intruder, 2026, 9, 3);

  -- ── There are three tiers, and only three ──────────────────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month, tier)
    values (v_owner, 2026, 11, 4);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a tier outside 1..3 must be refused';
  end if;

  -- ── The schedule runs backwards: day 1 is the heaviest ─────────────────────
  --
  -- September has 30 days, so at tier 1 day 1 is 30 x 1,000 and day 30 is 1,000.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_sep, 1, 30000);
  select amount_vnd into v_amount
    from public.savings_challenge_days where challenge_id = v_sep and day = 1;
  if v_amount <> 30000 then
    raise exception 'day 1 of a 30-day tier-1 month must be 30,000, got %', v_amount;
  end if;

  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_sep, 30, 1000);

  -- An amount that does not match the schedule is refused outright, whatever
  -- the client believed.
  v_failed := false;
  begin
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_sep, 2, 1000);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an amount that disagrees with the schedule must be refused';
  end if;

  -- ...and so is nudging one afterwards.
  v_failed := false;
  begin
    update public.savings_challenge_days set amount_vnd = 5000
     where challenge_id = v_sep and day = 1;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an amount cannot be edited away from the schedule';
  end if;

  -- ── A day is ticked once ───────────────────────────────────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_sep, 1, 30000);
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'the same day must not be tickable twice';
  end if;

  -- ── The tier locks once the first day is ticked ────────────────────────────
  v_failed := false;
  begin
    update public.savings_challenges set tier = 3 where challenge_id = v_sep;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'the tier must lock once a day has been ticked';
  end if;

  -- Nor can the challenge be dropped and re-picked to get around the lock.
  v_failed := false;
  begin
    delete from public.savings_challenges where challenge_id = v_sep;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a challenge with ticked days must not be deletable';
  end if;

  -- ── Before the first tick, the choice is still the user's ──────────────────
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 10, 1) returning challenge_id into v_oct;

  update public.savings_challenges set tier = 2 where challenge_id = v_oct;
  select tier into v_tier from public.savings_challenges where challenge_id = v_oct;
  if v_tier <> 2 then
    raise exception 'an untouched challenge must still be re-tierable, got %', v_tier;
  end if;

  -- Un-ticking the last day hands the choice back, too — the lock tracks what is
  -- ticked now, not what was ever ticked.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_oct, 31, 5000);  -- October has 31 days: (31 + 1 - 31) x 5,000
  delete from public.savings_challenge_days where challenge_id = v_oct and day = 31;
  update public.savings_challenges set tier = 3 where challenge_id = v_oct;

  -- ── October really has 31 days, and its day 1 is heavier than September's ──
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_oct, 1, 310000);  -- (31 + 1 - 1) x 10,000
  select amount_vnd into v_amount
    from public.savings_challenge_days where challenge_id = v_oct and day = 1;
  if v_amount <> 310000 then
    raise exception 'day 1 of a 31-day tier-3 month must be 310,000, got %', v_amount;
  end if;

  -- ── A day that does not exist in its month is refused ─────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_sep, 31, 10000);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'September has no day 31';
  end if;

  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2027, 2, 1) returning challenge_id into v_feb;

  v_failed := false;
  begin
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_feb, 29, 1000);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'February 2027 has no day 29';
  end if;

  -- February 2027 has 28 days, so its day 1 is 28,000 at tier 1 — the schedule
  -- shrinks with the month rather than always topping out at 30.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_feb, 1, 28000);

  -- ── One user's challenge is invisible to another ──────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_intruder::text)::text, true);
  begin
    set local role authenticated;
    select count(*) into v_seen from public.savings_challenges where user_id = v_owner;
    if v_seen <> 0 then
      raise exception 'a foreign challenge must not be readable, saw % row(s)', v_seen;
    end if;
    select count(*) into v_seen from public.savings_challenge_days where challenge_id = v_sep;
    if v_seen <> 0 then
      raise exception 'a foreign challenge''s days must not be readable, saw % row(s)', v_seen;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  -- ── The challenge leaves with its user ────────────────────────────────────
  --
  -- Including one whose days are ticked: the delete guard above protects the
  -- user from themselves, and must not turn account deletion into an error.
  delete from auth.users where id = v_owner;
  if exists (select 1 from public.savings_challenges where user_id = v_owner) then
    raise exception 'challenges must cascade when the user is deleted';
  end if;
  if exists (select 1 from public.savings_challenge_days where challenge_id = v_sep) then
    raise exception 'ticked days must cascade when the user is deleted';
  end if;

  raise notice 'savings challenge: pass';
end $$;

rollback;
