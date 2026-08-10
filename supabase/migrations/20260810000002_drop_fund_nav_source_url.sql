-- Contract half of the nav_source_url → nav_auto_sync swap. The expand half
-- (20260810000001) added the column, backfilled it, and put the nav_auto_sync
-- form of disable_fund_dca alongside the nav_source_url one so both releases
-- could run at once. This removes the old side, now that nothing reads it.
--
-- Safe in both deploy directions by construction. The code shipping with this
-- release reads nav_auto_sync, which has existed since the previous release, so
-- it works during the ~6 minutes it is live before this migration runs. The
-- code it replaces reads nav_source_url, which survives until the drop below.
--
-- The drop is irreversible, and was confirmed before this was written.

-- Reconcile the two columns one last time.
--
-- The expand backfill was a snapshot, and the release that has been live since
-- then writes nav_source_url without knowing about nav_auto_sync — so any fund
-- opted in or out during the compatibility window has the two columns
-- disagreeing. A fund created with a source URL in that window still carries the
-- false default and would silently stop syncing; one whose URL was cleared would
-- keep syncing. Re-deriving here fixes both, at the one instant no writer can
-- still be using the old column.
--
-- funds_updated_at is held off for the statement, as in the expand migration: it
-- stamps now() unconditionally, and the fund views render each fund's NAV age
-- from updated_at, so letting it fire would report every reconciled fund as
-- freshly repriced when no price was fetched.
alter table public.funds disable trigger funds_updated_at;

update public.funds
   set nav_auto_sync = (nav_source_url is not null)
 where nav_auto_sync is distinct from (nav_source_url is not null);

alter table public.funds enable trigger funds_updated_at;

-- Postgres overloads on argument types, so the nav_source_url form has to be
-- dropped explicitly — `create or replace` on the boolean form would leave it
-- callable, and PostgREST would keep routing any request that names
-- p_nav_source_url straight to a function writing a column that no longer
-- exists.
drop function if exists public.disable_fund_dca(uuid, text, text, text, numeric, text);

alter table public.funds drop column if exists nav_source_url;
