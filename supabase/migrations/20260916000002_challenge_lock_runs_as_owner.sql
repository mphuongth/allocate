-- The savings-challenge lock has to reach auth.users as its owner.
--
-- 20260916000001 gave the lock an escape hatch for account deletion: when the
-- cascade from auth.users removes a challenge, the parent row is already gone,
-- and the guard treats that absence as the signal to let the DELETE through
-- rather than refusing it and making the account undeletable.
--
-- The guard was SECURITY INVOKER, so that existence check ran as the caller —
-- and the caller is `authenticated`, which has no privileges on auth.users. So
-- every attempt to abandon a challenge from the app raised
--
--   42501: permission denied for table users
--
-- before the lock was ever consulted. "Huỷ thử thách" answered 500, on a month
-- with nothing ticked that the user was fully entitled to drop. The re-tier path
-- was unaffected: it returns before the auth.users check.
--
-- The original test missed it by running as the test's own superuser, which can
-- read auth.users — a guard proven only under a role the app never uses is not
-- proven at all. supabase/tests/savings_challenge.test.sql now drives the lock
-- under `set role authenticated` as well, and fails without this migration.
--
-- ── why SECURITY DEFINER is the right fix, not a widening ────────────────────
--
-- The function reads two things and returns a row: does this user still exist,
-- and does this challenge have any ticked days. It selects no column from
-- either, exposes nothing to the caller, takes no arguments to be steered with,
-- and its only outputs are OLD/NEW unchanged or an exception. Running it as the
-- owner grants the caller no read they did not already have.
--
-- Bypassing RLS on savings_challenge_days is a correctness gain rather than a
-- cost: a guard has to see the true state of the table. Under the caller's RLS
-- the day count was only ever right because the policy happens to admit exactly
-- the owner's rows — a guard whose answer depends on a policy elsewhere agreeing
-- with it is one policy edit away from silently unlocking.
--
-- search_path is pinned empty, as every SECURITY DEFINER function here is, so
-- nothing it names can be resolved to a caller-controlled schema.

create or replace function public.assert_challenge_unlocked()
returns trigger
language plpgsql
security definer
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
  -- signal. Reachable only as the owner, which is what this migration fixes.
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

comment on function public.assert_challenge_unlocked() is
  'Freezes a savings challenge''s tier once any day is ticked, and lets the auth.users cascade through. SECURITY DEFINER because authenticated cannot read auth.users (#726).';
