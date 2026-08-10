-- Add funds.nav_auto_sync alongside funds.nav_source_url (expand half of an
-- expand/contract; the contract half drops the old column in a later release).
--
-- Why this is split from the code change that uses it: on a merge to main,
-- Vercel goes live in about a minute while the migrate job waits on all five CI
-- gates and starts roughly six minutes later. Ship both together and the new
-- code spends that gap querying a column the database does not have yet — and if
-- the migrate job then fails, as it did on 2026-08-07 (an upstream Supabase CLI
-- regression), it never heals. Landing the schema first makes the deploy order
-- irrelevant: nothing reads this column until the follow-up release.
--
-- Everything here is additive and invisible to the code currently in production.

alter table public.funds
  add column if not exists nav_auto_sync boolean not null default false;

comment on column public.funds.nav_auto_sync is
  'Whether this fund''s NAV is refreshed automatically from the upstream price feed, matched by funds.code. Replaces nav_source_url, which is dropped in a later migration.';

-- Preserve every existing opt-in: a fund that had a source URL was being synced,
-- and must keep being synced once the new column is the one consulted.
--
-- A snapshot on its own would go stale: the release still in production writes
-- nav_source_url and knows nothing about nav_auto_sync, so a fund opted in or
-- out afterwards would leave the two columns disagreeing. The trigger added
-- below keeps them in step for as long as that release is live, which is why
-- there is no reconciliation to run later — see the note there.
--
-- funds_updated_at is held off for exactly this statement. It is a BEFORE UPDATE
-- trigger that stamps now() unconditionally — it overwrites even an explicit
-- `set updated_at = <old value>`, so restoring the timestamps afterwards is not
-- an option. The fund-library views render each fund's NAV age from updated_at,
-- so letting it fire here would tell every user that every fund had just been
-- repriced, at the one moment their prices are as stale as they were before the
-- deploy. This migration moves a flag; it fetches no NAV and must not claim to.
--
-- Only this trigger is disabled, by name: the ownership and owner-immutability
-- guards on funds stay armed for the write.
alter table public.funds disable trigger funds_updated_at;

update public.funds
   set nav_auto_sync = true
 where nav_source_url is not null;

alter table public.funds enable trigger funds_updated_at;

-- Keep the two columns in step while the old release is still writing the old
-- one. This is what removes the need to reconcile them later, and reconciling
-- later is not actually possible to do correctly: by the time the contract
-- migration runs, the new release has already been live for several minutes
-- writing nav_auto_sync *without* touching nav_source_url, so a
-- `set nav_auto_sync = (nav_source_url is not null)` at that point cannot tell a
-- fund the old code opted in from one the user has just switched off — and would
-- reverse the latter. Fixing the drift at the source leaves nothing to guess.
--
-- The two guards are what make this safe across both deployment windows:
--
--   * UPDATE OF nav_source_url — fires only when a statement actually assigns
--     that column. The old release always sends it; the new release never
--     mentions it, so a post-cutover flag change is left alone.
--   * the INSERT escape below — BEFORE INSERT has no column list, so without it
--     a row inserted by the new release with the flag on and no URL (there is no
--     URL to send any more) would be forced back off.
create or replace function public.sync_fund_nav_auto_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Nothing to derive from: respect whatever the caller supplied.
  if tg_op = 'INSERT' and new.nav_source_url is null then
    return new;
  end if;

  new.nav_auto_sync := new.nav_source_url is not null;
  return new;
end;
$$;

create trigger funds_sync_nav_auto_sync
  before insert or update of nav_source_url on public.funds
  for each row
  execute function public.sync_fund_nav_auto_sync();

-- disable_fund_dca writes the fund config in the same transaction as the DCA
-- cleanup, so its signature carries whichever column is authoritative. Add the
-- nav_auto_sync form as a SECOND overload rather than replacing the existing
-- one: Postgres overloads on argument types, and PostgREST picks by the argument
-- *names* in the request body, so `p_nav_source_url` and `p_nav_auto_sync`
-- resolve unambiguously. That lets the code still running in production keep
-- calling the old form throughout the changeover. The old overload is dropped in
-- the same later migration that drops the column.
create or replace function public.disable_fund_dca(
  p_fund_id uuid,
  p_name text,
  p_code text,
  p_fund_type text,
  p_nav numeric,
  p_nav_auto_sync boolean
)
returns public.funds
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fund public.funds;
begin
  -- UPDATE takes a row lock that conflicts with seed_and_sync_plan_dca's
  -- FOR SHARE lock. Whichever path starts first completes before the other can
  -- decide whether this fund is eligible for seeding.
  update public.funds
     set name = p_name,
         code = p_code,
         fund_type = p_fund_type,
         nav = p_nav,
         -- NULL means "the caller didn't send the flag" — keep the current
         -- setting. A partial write must not switch automatic pricing off
         -- behind the user, and the column is NOT NULL, so a bare assignment
         -- would fail the write instead.
         nav_auto_sync = coalesce(p_nav_auto_sync, nav_auto_sync),
         is_dca = false,
         dca_monthly_amount_vnd = null,
         dca_goal_id = null
   where id = p_fund_id
     and user_id = auth.uid()
  returning * into v_fund;

  if not found then
    raise no_data_found using message = 'Fund not found';
  end if;

  delete from public.investment_transactions
   where user_id = v_fund.user_id
     and fund_id = v_fund.id
     and asset_type = 'fund'
     and is_dca_seeded
     and units is null;

  return v_fund;
end;
$$;
