-- The monthly savings challenge — pick a tier for the month, set aside a little
-- every day, heaviest on the 1st.
--
-- The schedule is the familiar 30-day challenge run backwards. At tier 1 a
-- 30-day month asks 30,000 on the 1st and 1,000 on the 30th; the total is the
-- same either way, but front-loading it means the hard days are the ones the
-- user is still enthusiastic about, and each remaining day is easier than the
-- last. Three tiers scale the unit: 1,000 / 5,000 / 10,000 a step.
--
--   amount(day) = (days in the month + 1 - day) x unit(tier)
--
-- The month's real length is what feeds that, so a 31-day month starts at
-- 31 units and February starts at 28. A fixed 30-row table would either invent a
-- 31st day the user cannot save on or cap every long month one day short.
--
-- This is a TRACKER: it records that a day was set aside, and never writes an
-- investment_transaction, touches a book, or moves a goal's progress. Nothing
-- here participates in net worth. That is deliberate — the challenge is a habit,
-- and the money it produces reaches the app the same way any other cash does,
-- when the user actually banks it.
--
-- ── what the database owns, and why it is not the route's job ────────────────
--
-- The lock is the feature. A challenge whose tier can be lowered in week three
-- is not a challenge, so: once ANY day of a month is ticked, that month's tier
-- is frozen and the challenge row cannot be deleted. Both are statements about
-- rows that already exist, and the answer ("has anything been ticked yet")
-- changes under concurrent writes — a check in the route reads it one statement
-- too early and two requests can both pass it. Before the first tick the choice
-- is entirely the user's: re-tier freely, or delete the row and opt out.
--
-- The lock tracks what is ticked NOW, not what was ever ticked. Un-ticking the
-- last day hands the choice back, which is the honest reading of an empty month
-- and costs nothing: a user who un-ticks every day to re-tier has also given up
-- every day of progress, so there is nothing left to cheat.
--
-- amount_vnd is stored rather than derived on read, so a month's history stays
-- true if the tiers are ever re-scaled. A stored number nobody checks is how a
-- tracker starts disagreeing with its own total, so the trigger recomputes it
-- from the parent's year/month/tier and refuses a row that disagrees — the
-- client may not assert an amount, only arrive at the same one.

-- ── the month's choice ───────────────────────────────────────────────────────

create table if not exists public.savings_challenges (
  challenge_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year smallint not null check (year between 2000 and 2200),
  month smallint not null check (month between 1 and 12),
  -- 1 / 2 / 3 rather than the unit itself. The units are a product decision that
  -- lives in lib/savingsChallenge, and naming the tier keeps a past month's rows
  -- readable as "the user picked mức 2" even if the units are re-scaled later.
  tier smallint not null check (tier in (1, 2, 3)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, month)
);

comment on table public.savings_challenges is
  'One savings-challenge tier per user per month. Frozen once any day is ticked.';

alter table public.savings_challenges enable row level security;

create policy "savings_challenges_select" on public.savings_challenges
  for select to authenticated using (user_id = auth.uid());
create policy "savings_challenges_insert" on public.savings_challenges
  for insert to authenticated with check (user_id = auth.uid());
create policy "savings_challenges_update" on public.savings_challenges
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "savings_challenges_delete" on public.savings_challenges
  for delete to authenticated using (user_id = auth.uid());

-- ── the days that were set aside ─────────────────────────────────────────────

create table if not exists public.savings_challenge_days (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.savings_challenges(challenge_id) on delete cascade,
  -- Bounded to a real calendar day here; whether THIS month has that day is the
  -- trigger's job, since it needs the parent row to answer.
  day smallint not null check (day between 1 and 31),
  amount_vnd bigint not null check (amount_vnd > 0),
  created_at timestamptz not null default now(),
  unique (challenge_id, day)
);

comment on table public.savings_challenge_days is
  'One row per day of a savings challenge that was set aside. Presence = ticked.';

-- Every read of this table is "the days of one challenge" — the month view, the
-- dashboard card's progress, and the lock trigger below. The unique constraint
-- already indexes (challenge_id, day) and serves all three.

alter table public.savings_challenge_days enable row level security;

create policy "savings_challenge_days_select" on public.savings_challenge_days
  for select to authenticated
  using (challenge_id in (select challenge_id from public.savings_challenges where user_id = auth.uid()));
create policy "savings_challenge_days_insert" on public.savings_challenge_days
  for insert to authenticated
  with check (challenge_id in (select challenge_id from public.savings_challenges where user_id = auth.uid()));
create policy "savings_challenge_days_delete" on public.savings_challenge_days
  for delete to authenticated
  using (challenge_id in (select challenge_id from public.savings_challenges where user_id = auth.uid()));

-- No UPDATE policy, and none is coming. A ticked day has exactly two states, and
-- both are reachable: insert to tick, delete to un-tick. Editing one in place
-- could only mean re-pointing it at a different day or a different amount, and
-- the trigger refuses both anyway — this way the refusal is the absence of a
-- policy rather than an error the client has to read.

-- ── the schedule ─────────────────────────────────────────────────────────────

-- immutable: the answer depends on nothing but its arguments, which is what lets
-- the trigger below call it freely and what makes it safe to reason about as
-- "the schedule" rather than "the schedule as of now".
create or replace function public.savings_challenge_day_amount(
  p_year smallint, p_month smallint, p_tier smallint, p_day smallint
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
  ) * case p_tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end)::bigint
$$;

comment on function public.savings_challenge_day_amount(smallint, smallint, smallint, smallint) is
  'The savings challenge schedule, run backwards: (days in month + 1 - day) x the tier unit (#724).';

grant execute on function public.savings_challenge_day_amount(smallint, smallint, smallint, smallint)
  to authenticated, service_role;

-- ── a ticked day belongs to its month, and carries its month's amount ────────

create or replace function public.assert_challenge_day_on_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.savings_challenges;
  v_expected bigint;
begin
  select * into v_c from public.savings_challenges where challenge_id = new.challenge_id;
  if not found then
    -- Unreachable through the FK, but a trigger that silently passes on a
    -- missing parent is the kind of hole that outlives the constraint.
    raise exception 'savings challenge: the day names a challenge that does not exist'
      using errcode = 'check_violation';
  end if;

  v_expected := public.savings_challenge_day_amount(v_c.year, v_c.month, v_c.tier, new.day);

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

-- BEFORE UPDATE as well as INSERT, even though no UPDATE policy exists: the
-- trigger is what makes the missing policy a decision rather than an oversight,
-- and it still runs for service_role and for any future migration that edits
-- these rows in place.
create trigger savings_challenge_day_on_schedule
  before insert or update on public.savings_challenge_days
  for each row execute function public.assert_challenge_day_on_schedule();

-- ── the tier freezes at the first tick ───────────────────────────────────────

create or replace function public.assert_challenge_unlocked()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- An UPDATE that leaves the tier alone is always fine — that is what lets
  -- updated_at be touched, and what keeps a future column from inheriting a lock
  -- that was only ever about the tier.
  if tg_op = 'UPDATE' and new.tier is not distinct from old.tier then
    return new;
  end if;

  -- The account is being deleted and this row is coming with it (the cascade
  -- from auth.users). The guard exists to protect the user from re-picking a
  -- month mid-flight, not to make their account undeletable — and by the time
  -- the cascade reaches here the parent is already gone, which is exactly the
  -- signal.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;

  -- Locking on what is ticked NOW: un-ticking the last day hands the choice
  -- back. A user who does that has surrendered the month's whole progress to get
  -- there, so there is nothing left for the re-pick to protect.
  if exists (select 1 from public.savings_challenge_days where challenge_id = old.challenge_id) then
    raise exception 'savings challenge: the tier is locked once a day has been set aside'
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

create trigger savings_challenge_locked
  before update or delete on public.savings_challenges
  for each row execute function public.assert_challenge_unlocked();
