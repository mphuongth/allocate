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

-- There is deliberately no reconciliation here.
--
-- An earlier draft re-derived the flag — `set nav_auto_sync = (nav_source_url is
-- not null)` — on the theory that the expand backfill had gone stale. It had,
-- but this is the wrong place to fix it: by the time this runs, the release that
-- reads nav_auto_sync has been live for several minutes writing it *without*
-- touching nav_source_url. Re-deriving cannot tell a fund the old code opted in
-- from one the user has just switched off, and reverses the latter — measured:
-- a fund switched off after cutover came back on. The expand migration keeps the
-- columns in step at the source instead, with funds_sync_nav_auto_sync, so by
-- now they already agree and there is nothing to repair.

-- That trigger exists only for the window this migration closes.
drop trigger if exists funds_sync_nav_auto_sync on public.funds;
drop function if exists public.sync_fund_nav_auto_sync();

-- Postgres overloads on argument types, so the nav_source_url form has to be
-- dropped explicitly — `create or replace` on the boolean form would leave it
-- callable, and PostgREST would keep routing any request that names
-- p_nav_source_url straight to a function writing a column that no longer
-- exists.
drop function if exists public.disable_fund_dca(uuid, text, text, text, numeric, text);

alter table public.funds drop column if exists nav_source_url;
