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
-- And a fifth, which is really a property of the other four: each has to hold
-- FOR THE ROLE THE APP ACTUALLY USES. A guard that works as superuser and raises
-- `permission denied` as `authenticated` is not a guard, it is an outage — which
-- is exactly what the first version of the lock was, because it consults
-- auth.users and `authenticated` cannot read that table. So the lock is also
-- exercised under `set role authenticated` below, the way a request from the
-- browser reaches it.
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
  v_dec      uuid;  -- December 2026 — an untouched month, abandoned below
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

  -- ── The lock holds for the role the app signs in as ───────────────────────
  --
  -- Everything above ran as the test's own (super)user, which is not who touches
  -- these rows in production. `authenticated` is, and it cannot read auth.users
  -- — so a guard that consults it has to reach it as its owner or the DELETE
  -- fails with 42501 before the lock is ever consulted. The un-ticked month is
  -- abandonable and the ticked one is not, under that role.
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 12, 2) returning challenge_id into v_dec;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text)::text, true);
  begin
    set local role authenticated;

    -- Ticking a day, too: the schedule trigger reads the parent challenge, and
    -- the same lesson applies to it — a guard is only proven under the role that
    -- actually reaches it. (This one is fine as invoker: RLS on
    -- savings_challenges admits exactly the owner, so it fails CLOSED if that
    -- ever changes, rather than letting a wrong amount through.)
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_dec, 1, 155000);  -- December has 31 days, at tier 2: 31 x 5,000

    v_failed := false;
    begin
      insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
      values (v_dec, 2, 1000);
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'a wrong amount must still be refused for authenticated';
    end if;

    -- ...and that tick locks the month, for this role as much as any other.
    v_failed := false;
    begin
      update public.savings_challenges set tier = 1 where challenge_id = v_dec;
    exception
      when check_violation then v_failed := true;
      when insufficient_privilege then
        raise exception 'the lock must reach auth.users as its owner, not as the caller';
    end;
    if not v_failed then
      raise exception 'a ticked month must lock for authenticated too';
    end if;

    -- Un-tick it, and an untouched month is re-tierable and then abandonable.
    delete from public.savings_challenge_days where challenge_id = v_dec and day = 1;
    update public.savings_challenges set tier = 3 where challenge_id = v_dec;

    delete from public.savings_challenges where challenge_id = v_dec;
    if exists (select 1 from public.savings_challenges where challenge_id = v_dec) then
      raise exception 'an untouched challenge must be abandonable as authenticated';
    end if;

    -- A month with days ticked: still locked, and refused as a check violation
    -- rather than a privilege error.
    v_failed := false;
    begin
      update public.savings_challenges set tier = 2 where challenge_id = v_sep;
    exception
      when check_violation then v_failed := true;
      when insufficient_privilege then
        raise exception 'the lock must reach auth.users as its owner, not as the caller';
    end;
    if not v_failed then
      raise exception 'the tier must stay locked for authenticated too';
    end if;

    v_failed := false;
    begin
      delete from public.savings_challenges where challenge_id = v_sep;
    exception
      when check_violation then v_failed := true;
      when insufficient_privilege then
        raise exception 'the delete guard must reach auth.users as its owner, not as the caller';
    end;
    if not v_failed then
      raise exception 'a ticked challenge must stay undeletable for authenticated too';
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

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

-- ── The month's step is a chosen amount, not a tier (20260921000001) ─────────
--
-- The picker stopped being `mức 1 / 2 / 3` and became the number itself, 1,000
-- through 10,000 in thousands. `tier` is still on the table while the deployed
-- client writes it, so what this proves is the pair of them living together: a
-- row written the new way schedules from unit_vnd, a row written the old way
-- still schedules from tier, and a row that names neither cannot exist.
do $$
declare
  v_owner  uuid := gen_random_uuid();
  v_sep    uuid;
  v_old    uuid;
  v_amount bigint;
  v_unit   bigint;
  v_failed boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'challenge-unit@test.invalid');

  -- ── A challenge can name its step and nothing else ────────────────────────
  insert into public.savings_challenges (user_id, year, month, unit_vnd)
  values (v_owner, 2026, 9, 3000) returning challenge_id into v_sep;

  -- September has 30 days, so at 3,000 a step day 1 is 90,000 and day 30 is
  -- 3,000 — the same heaviest-first shape, generated from the chosen number.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_sep, 1, 90000);
  select amount_vnd into v_amount
    from public.savings_challenge_days where challenge_id = v_sep and day = 1;
  if v_amount <> 90000 then
    raise exception 'day 1 of a 30-day 3,000 month must be 90,000, got %', v_amount;
  end if;

  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_sep, 30, 3000);

  v_failed := false;
  begin
    insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
    values (v_sep, 2, 3000);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an amount that disagrees with the chosen step must be refused';
  end if;

  -- ── The step locks with the first tick, exactly as the tier did ───────────
  --
  -- The lock used to watch `tier` alone. Re-pricing a ticked month through the
  -- new column is the same move under a different name, and has to meet the
  -- same refusal.
  v_failed := false;
  begin
    update public.savings_challenges set unit_vnd = 10000 where challenge_id = v_sep;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'the step must lock once a day has been ticked';
  end if;

  -- ── The ten steps, and only those ─────────────────────────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month, unit_vnd)
    values (v_owner, 2026, 11, 11000);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a step above 10,000 must be refused';
  end if;

  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month, unit_vnd)
    values (v_owner, 2026, 11, 2500);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a step off the 1,000 grid must be refused';
  end if;

  -- ── A challenge has to price its days somehow ─────────────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month)
    values (v_owner, 2026, 11);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a challenge naming neither a step nor a tier must be refused';
  end if;

  -- ── A row the deployed client wrote still schedules from its tier ─────────
  --
  -- This is the whole reason the column arrived nullable: for the window between
  -- `db push` and the deploy, both shapes have to tick without either one
  -- meeting a refusal.
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 10, 2) returning challenge_id into v_old;
  -- Clearing the step back out is a no-op now (20260921000002 fills it straight
  -- back in), which is the point: there is no way left to reach the state where
  -- a row names a tier and no step.
  update public.savings_challenges set unit_vnd = null where challenge_id = v_old;

  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_old, 1, 155000);  -- October has 31 days, at the tier-2 unit: 31 x 5,000
  select amount_vnd into v_amount
    from public.savings_challenge_days where challenge_id = v_old and day = 1;
  if v_amount <> 155000 then
    raise exception 'a tier-only month must still schedule from its tier, got %', v_amount;
  end if;

  -- ── Deriving the step never moves a month's amounts ───────────────────────
  --
  -- 20260921000002 fills unit_vnd in from the tier at insert time rather than
  -- leaving it null. What matters is that the number it arrives at is the one
  -- the tier already meant: a December at tier 3 opens at 310,000 either way.
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 12, 3) returning challenge_id into v_old;
  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_old;
  if v_unit <> 10000 then
    raise exception 'a tier-only insert must land at the tier''s own step, got %',
      coalesce(v_unit::text, 'NULL');
  end if;
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_old, 1, 310000);  -- 31 x 10,000, the same either way

  delete from auth.users where id = v_owner;

  raise notice 'savings challenge step: pass';
end $$;

-- ── A challenge always knows what a day costs ───────────────────────────────
--
-- 20260921000001 let `unit_vnd` be null so the then-deployed app could go on
-- inserting a bare `tier` until the client that writes steps shipped. The day
-- trigger coped, through a coalesce — but the ROW did not: a challenge created
-- in that window carried unit_vnd = NULL, and the new client prices a month from
-- unit_vnd alone. Every day of such a month computes to 0, which the tick route
-- reads as "this month has no day 16" and refuses; and if a day was ticked
-- before the deploy, the lock refuses the PATCH that would repair it. The month
-- is stuck.
--
-- So the fallback moves from the day trigger to the insert: whatever names the
-- step, the row is stored knowing it.
do $$
declare
  v_owner  uuid := gen_random_uuid();
  v_c      uuid;
  v_unit   bigint;
  v_failed boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'challenge-window@test.invalid');

  -- ── A tier-only insert — exactly what the old client sends ────────────────
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 9, 2) returning challenge_id into v_c;

  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_c;
  if v_unit is distinct from 5000 then
    raise exception 'a tier-only insert must land with its step stored, got %',
      coalesce(v_unit::text, 'NULL');
  end if;

  -- ...and the month is immediately usable by the client that reads unit_vnd:
  -- September has 30 days, so day 1 at a 5,000 step is 150,000.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_c, 1, 150000);

  -- ── An explicit step is never overwritten by a tier ───────────────────────
  --
  -- The two can arrive together only from a client mid-switch, and the step is
  -- the one the user actually chose.
  insert into public.savings_challenges (user_id, year, month, tier, unit_vnd)
  values (v_owner, 2026, 10, 1, 7000) returning challenge_id into v_c;
  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_c;
  if v_unit <> 7000 then
    raise exception 'an explicit step must win over a tier, got %', v_unit;
  end if;

  -- ── Nulling the step back out is refused, not silently re-derived ─────────
  --
  -- An UPDATE that clears unit_vnd would re-create the stuck month this guard
  -- exists to prevent. With a tier still on the row the fallback fills it back
  -- in; the point is that the row never ends up null either way.
  update public.savings_challenges set unit_vnd = null where challenge_id = v_c;
  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_c;
  if v_unit is null then
    raise exception 'a step must not be nullable back out of an existing row';
  end if;

  -- ── The old client's re-tier moves the step with it ──────────────────────
  --
  -- That client PATCHes `tier` alone. If the step stayed at whatever the row was
  -- created with, the two columns would disagree — and every reader, old or new,
  -- would price the month from a different one.
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 12, 1) returning challenge_id into v_c;
  update public.savings_challenges set tier = 3 where challenge_id = v_c;
  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_c;
  if v_unit <> 10000 then
    raise exception 'a bare re-tier must carry the step with it, got %', v_unit;
  end if;
  -- December has 31 days, so day 31 at the tier-3 step is 10,000.
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_c, 31, 10000);

  -- ...but a re-tier of a TICKED month still meets the lock, rather than being
  -- quietly re-priced underneath it. This is why the lock trigger has to fire
  -- first, and why it sees the tier the caller actually sent.
  v_failed := false;
  begin
    update public.savings_challenges set tier = 1 where challenge_id = v_c;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a ticked month must lock against a bare re-tier too';
  end if;

  -- ── With neither, the row still cannot exist ──────────────────────────────
  v_failed := false;
  begin
    insert into public.savings_challenges (user_id, year, month)
    values (v_owner, 2026, 11);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a challenge naming neither a step nor a tier must be refused';
  end if;

  delete from auth.users where id = v_owner;

  raise notice 'savings challenge window: pass';
end $$;

rollback;

-- ── Filling a missing step in is a repair, not a re-price ───────────────────
--
-- The row this shape exists to fix is the worst case of it: a tier-only
-- challenge with a day ALREADY ticked. 20260921000002 has to write unit_vnd onto
-- exactly that row — and the lock, which since 20260921000001 watches unit_vnd,
-- reads the write as a repricing and raises. One such row in production would
-- abort the migration before its trigger was installed and take `db push` down
-- mid-deploy.
--
-- It is not a repricing. The day amounts were computed from the tier all along
-- (the coalesce in the day trigger), so writing the tier's OWN unit into
-- unit_vnd leaves every amount in the month byte-identical. That, and only that,
-- is what the lock now lets through: a null step filled with the number the
-- month was already priced at. Any other value on a ticked month is still the
-- move the lock exists to refuse.
--
-- The step-from-tier trigger is switched off here so the pre-migration row shape
-- can be built at all — after 20260921000002 there is no other way to reach it,
-- which is the point of that trigger.
begin;
alter table public.savings_challenges disable trigger savings_challenge_step_from_tier;

do $$
declare
  v_owner  uuid := gen_random_uuid();
  v_c      uuid;
  v_unit   bigint;
  v_failed boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'challenge-repair@test.invalid');

  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 9, 2) returning challenge_id into v_c;
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_c, 1, 150000);  -- September has 30 days, at the tier-2 unit: 30 x 5,000

  -- The migration's own backfill, on a locked row.
  update public.savings_challenges
  set unit_vnd = case tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end
  where challenge_id = v_c;

  select unit_vnd into v_unit from public.savings_challenges where challenge_id = v_c;
  if v_unit <> 5000 then
    raise exception 'the backfill must reach a locked tier-only row, got %',
      coalesce(v_unit::text, 'NULL');
  end if;

  -- ...and the month is unchanged by it: day 1 is still what it was ticked at.
  if not exists (
    select 1 from public.savings_challenge_days
    where challenge_id = v_c and day = 1 and amount_vnd = 150000
  ) then
    raise exception 'the backfill must not move an amount that was already ticked';
  end if;

  -- ── Any OTHER value is still the repricing the lock refuses ──────────────
  insert into public.savings_challenges (user_id, year, month, tier)
  values (v_owner, 2026, 10, 1) returning challenge_id into v_c;
  insert into public.savings_challenge_days (challenge_id, day, amount_vnd)
  values (v_c, 1, 31000);  -- October has 31 days, at the tier-1 unit

  v_failed := false;
  begin
    -- Not the tier's own unit: this would re-price a month that is already part
    -- ticked, which is the whole thing the lock is for.
    update public.savings_challenges set unit_vnd = 10000 where challenge_id = v_c;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'filling a step must not be a way to re-price a ticked month';
  end if;

  -- And once a step is there, moving it is refused as it always was.
  update public.savings_challenges set unit_vnd = 1000 where challenge_id = v_c;
  v_failed := false;
  begin
    update public.savings_challenges set unit_vnd = 2000 where challenge_id = v_c;
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'a step that is already set must stay locked';
  end if;

  delete from auth.users where id = v_owner;

  raise notice 'savings challenge repair: pass';
end $$;

rollback;
