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
