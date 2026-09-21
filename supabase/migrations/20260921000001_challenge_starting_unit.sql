-- The savings challenge stops being three tiers and becomes a chosen amount.
--
-- The picker was `mức 1 / mức 2 / mức 3`, three fixed units (1k / 5k / 10k)
-- borrowed from the table the feature came from. The names carried no meaning on
-- their own — "mức 2" tells a user nothing about what a day will cost — and the
-- three steps skip the whole middle of the range that table actually lays out,
-- which runs 1,000 through 10,000 in thousands. So the choice becomes the number
-- itself: pick the step, and the month's schedule generates from it.
--
--   amount(day) = (days in the month + 1 - day) x unit_vnd
--
-- The shape of the schedule does not change. It still runs heaviest-first, so a
-- 30-day month at 3,000 opens at 90,000 and closes at 3,000; the total is the
-- same as the ascending version and the hard days land while the enthusiasm is
-- still there (20260916000001).
--
-- ── why this adds a column instead of replacing one ──────────────────────────
--
-- `tier` is still what the deployed app inserts and reads. A migration that
-- renamed it would break every running client between `db push` and the deploy
-- that follows, so this one is purely additive and the app switches over in its
-- own change:
--
--   * unit_vnd arrives NULLABLE, checked to the 1,000–10,000 range;
--   * existing rows are backfilled from their tier, so every already-ticked day
--     keeps the exact amount it was ticked at;
--   * tier loses its NOT NULL, so a client that has moved on can omit it;
--   * the amount trigger reads `coalesce(unit_vnd, the tier's unit)`, which is
--     what lets an old client and a new one write to the same table without
--     either one meeting a refusal.
--
-- A later migration drops `tier` and makes `unit_vnd` NOT NULL, once nothing
-- writes a tier any more.

-- ── the chosen amount ────────────────────────────────────────────────────────

alter table public.savings_challenges
  add column if not exists unit_vnd bigint;

-- The ten steps of the table, stated as arithmetic rather than as a list: the
-- range plus the thousand-step is exactly "1,000 through 10,000 in thousands",
-- and it stays readable if the range is ever widened.
alter table public.savings_challenges
  drop constraint if exists savings_challenges_unit_vnd_check;
alter table public.savings_challenges
  add constraint savings_challenges_unit_vnd_check
  check (unit_vnd is null or (unit_vnd between 1000 and 10000 and unit_vnd % 1000 = 0));

comment on column public.savings_challenges.unit_vnd is
  'The month''s chosen step: amount(day) = (days in month + 1 - day) x unit_vnd (#732).';

-- The same units the tiers meant, so no month's history moves. A row still
-- reading its amounts from `tier` would keep working through the coalesce below
-- anyway; the backfill is here so the follow-up migration that drops `tier` has
-- nothing left to lose.
update public.savings_challenges
set unit_vnd = case tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end
where unit_vnd is null and tier is not null;

-- A row has to say what a day costs, one way or the other. Without this, a
-- client that omitted both would insert a challenge whose every day computes to
-- NULL, and the day trigger would refuse each tick as an amount mismatch instead
-- of the month refusing to exist.
alter table public.savings_challenges
  alter column tier drop not null;
alter table public.savings_challenges
  drop constraint if exists savings_challenges_step_present;
alter table public.savings_challenges
  add constraint savings_challenges_step_present
  check (unit_vnd is not null or tier is not null);

-- ── the schedule, from the step ──────────────────────────────────────────────

create or replace function public.savings_challenge_day_amount(
  p_year smallint, p_month smallint, p_unit_vnd bigint, p_day smallint
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select ((
    -- Days in the month: step to the 1st of the next month and back one day.
    extract(day from (make_date(p_year::int, p_month::int, 1) + interval '1 month' - interval '1 day'))::int
    + 1 - p_day::int
  ) * p_unit_vnd)::bigint
$$;

comment on function public.savings_challenge_day_amount(smallint, smallint, bigint, smallint) is
  'The savings challenge schedule, run backwards: (days in month + 1 - day) x the month''s step (#732).';

grant execute on function public.savings_challenge_day_amount(smallint, smallint, bigint, smallint)
  to authenticated, service_role;

-- The tier overload stays for as long as `tier` does: dropping it now would
-- break the deployed app's own reading of the schedule mid-deploy, which is the
-- thing this migration is shaped to avoid.

-- ── a ticked day carries its month's amount, whichever column names it ───────

create or replace function public.assert_challenge_day_on_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c        public.savings_challenges;
  v_unit     bigint;
  v_expected bigint;
begin
  select * into v_c from public.savings_challenges where challenge_id = new.challenge_id;
  if not found then
    -- Unreachable through the FK, but a trigger that silently passes on a
    -- missing parent is the kind of hole that outlives the constraint.
    raise exception 'savings challenge: the day names a challenge that does not exist'
      using errcode = 'check_violation';
  end if;

  -- The month's own step wins; `tier` is consulted only for a row written by a
  -- client that has not moved over yet. The CHECK above guarantees one of them
  -- is there, so v_unit is never null.
  v_unit := coalesce(
    v_c.unit_vnd,
    case v_c.tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end
  );

  v_expected := public.savings_challenge_day_amount(v_c.year, v_c.month, v_unit, new.day);

  -- A day outside the month reads as a non-positive amount: at day = days + 1
  -- the schedule is exactly 0, and it goes negative from there. Naming the
  -- calendar in the message rather than the arithmetic is what the user needs.
  if v_expected <= 0 then
    raise exception 'savings challenge: %-% has no day %', v_c.year, v_c.month, new.day
      using errcode = 'check_violation';
  end if;

  if new.amount_vnd is distinct from v_expected then
    raise exception 'savings challenge: day % of %-% is %, not %',
      new.day, v_c.year, v_c.month, v_expected, new.amount_vnd
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ── the lock freezes the step, not just the tier ─────────────────────────────

create or replace function public.assert_challenge_unlocked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An UPDATE that leaves the month's step alone is always fine — that is what
  -- lets updated_at be touched, and what keeps a future column from inheriting a
  -- lock that was only ever about what a day costs. unit_vnd joins tier here the
  -- moment it exists: a lock that still watched only `tier` would let a ticked
  -- month be re-priced through the new column, which is the very move it exists
  -- to refuse.
  if tg_op = 'UPDATE'
     and new.tier is not distinct from old.tier
     and new.unit_vnd is not distinct from old.unit_vnd then
    return new;
  end if;

  -- The account is being deleted and this row is coming with it (the cascade
  -- from auth.users). The guard exists to protect the user from re-picking a
  -- month mid-flight, not to make their account undeletable — and by the time
  -- the cascade reaches here the parent is already gone, which is exactly the
  -- signal. Reachable only as the owner (20260916000002).
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;

  -- Locking on what is ticked NOW: un-ticking the last day hands the choice
  -- back. A user who does that has surrendered the month's whole progress to get
  -- there, so there is nothing left for the re-pick to protect.
  if exists (select 1 from public.savings_challenge_days where challenge_id = old.challenge_id) then
    raise exception 'savings challenge: the amount is locked once a day has been set aside'
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

comment on function public.assert_challenge_unlocked() is
  'Freezes a savings challenge''s step once any day is ticked, and lets the auth.users cascade through. SECURITY DEFINER because authenticated cannot read auth.users (#726).';
