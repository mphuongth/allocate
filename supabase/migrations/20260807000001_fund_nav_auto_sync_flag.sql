-- Replace funds.nav_source_url with an explicit funds.nav_auto_sync flag (#643 follow-up).
--
-- nav_source_url stopped being fetched when NAV pricing moved to a single
-- upstream feed keyed by fund code. What survived was a field that looked like
-- it determined the price but did not: only its NULL-ness mattered, as the
-- per-fund opt-in for automatic pricing. That left the write path demanding a
-- valid https URL on one of four vendor hosts just to flip a switch, while the
-- value that actually decides the price — funds.code — was validated against
-- nothing.
--
-- This migration makes the column say what it does. The URL itself carried no
-- information the app still reads, so it is dropped rather than parked: a
-- retained column that nothing writes decays into a trap for the next reader.
-- The drop is irreversible, and was confirmed before this was written.

alter table public.funds
  add column if not exists nav_auto_sync boolean not null default false;

-- Preserve every existing opt-in: a fund that had a source URL was being synced,
-- and must keep being synced.
update public.funds
   set nav_auto_sync = true
 where nav_source_url is not null;

comment on column public.funds.nav_auto_sync is
  'Whether this fund''s NAV is refreshed automatically from the upstream price feed, matched by funds.code.';

-- disable_fund_dca writes the fund config in the same transaction as the DCA
-- cleanup, so its signature carries the column. Postgres overloads on argument
-- types, so `create or replace` with a boolean where text used to be would leave
-- the old six-text-arg function callable alongside the new one — drop it first.
drop function if exists public.disable_fund_dca(uuid, text, text, text, numeric, text);

create or replace function public.disable_fund_dca(
  p_fund_id uuid,
  p_name text,
  p_code text,
  p_fund_type text,
  p_nav numeric,
  p_nav_auto_sync boolean default null
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

alter table public.funds drop column if exists nav_source_url;
