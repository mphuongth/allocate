-- A savings challenge always stores what a day costs.
--
-- 20260921000001 let `unit_vnd` be null on purpose: the then-deployed app still
-- inserted a bare `tier`, and refusing those would have broken the running
-- client between `db push` and the deploy that replaced it. The DAY trigger
-- coped by reading `coalesce(unit_vnd, the tier's unit)`.
--
-- The row did not. A challenge created in that window is stored with
-- unit_vnd = NULL, and the client that replaced it prices a month from unit_vnd
-- alone — so every day of that month computes to 0, the tick route reads 0 as
-- "this month has no day 16" and answers 409, and the card renders a schedule of
-- zeroes. Worse, if a day was ticked before the deploy, the lock refuses the
-- PATCH that would set a step, and the month cannot be repaired from the app at
-- all. Exactly one month can be in that state — the current one — which is the
-- only month the user can actually use.
--
-- The coalesce therefore moves from the day trigger to the INSERT: whatever
-- names the step, the row is stored knowing it. That is the difference between a
-- fallback the reader has to remember and a column that is simply always right —
-- and it is what lets the app keep `tier` out of its code entirely, rather than
-- carrying a mapping for a column it is trying to retire.

-- ── any row already stuck in that window ─────────────────────────────────────
--
-- Idempotent and cheap: after this migration the trigger below makes it
-- impossible to create another, so this is a one-time sweep rather than
-- something a later migration has to repeat.
update public.savings_challenges
set unit_vnd = case tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end
where unit_vnd is null and tier is not null;

-- ── and none created from here on ────────────────────────────────────────────

create or replace function public.challenge_step_from_tier()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_from_tier bigint := case new.tier when 1 then 1000 when 2 then 5000 when 3 then 10000 end;
begin
  -- Never derive over the top of nothing: with no tier there is nothing to
  -- derive from, and the CHECK that wants one of the two is the right place for
  -- that to be refused.
  if v_from_tier is null then
    return new;
  end if;

  -- An insert that named no step takes the tier's.
  if new.unit_vnd is null then
    new.unit_vnd := v_from_tier;
    return new;
  end if;

  -- An UPDATE that re-tiers and says nothing about the step is the old client's
  -- "Đổi mức". Leaving unit_vnd alone there would pin the month to the schedule
  -- it was CREATED at while the row claims a different tier — the two columns
  -- disagreeing is the one state neither client can read correctly. The explicit
  -- step still wins: if this statement set unit_vnd itself, it is untouched.
  if tg_op = 'UPDATE'
     and new.tier is distinct from old.tier
     and new.unit_vnd is not distinct from old.unit_vnd then
    new.unit_vnd := v_from_tier;
  end if;

  return new;
end;
$$;

comment on function public.challenge_step_from_tier() is
  'Fills unit_vnd from a legacy tier, so no challenge row is stored without a step (#734).';

-- BEFORE, so the value is in place by the time the CHECK that wants one of the
-- two is evaluated. UPDATE as well as INSERT: clearing unit_vnd back out would
-- re-create the stuck row this exists to prevent, and a bare re-tier has to move
-- the step with it.
--
-- The name matters. Triggers on one event fire in name order, so
-- `savings_challenge_locked` runs first and still sees the tier the caller
-- actually sent — a ticked month meets the lock rather than being quietly
-- re-priced underneath it.
drop trigger if exists savings_challenge_step_from_tier on public.savings_challenges;
create trigger savings_challenge_step_from_tier
  before insert or update on public.savings_challenges
  for each row execute function public.challenge_step_from_tier();
