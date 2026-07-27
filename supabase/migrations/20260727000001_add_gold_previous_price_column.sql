-- Add gold_price_settings.previous_price_per_chi, which the app has always read
-- but no migration ever created.
--
-- 20260325000001 defines the table as (user_id, price_per_chi, updated_at). The
-- gold-price GET selects previous_price_per_chi, and the refresh POST both
-- writes and selects it — so the column exists on the hosted project, added out
-- of band rather than through a migration. That drift stayed invisible there
-- while every environment rebuilt from the migration set (a fresh local stack, a
-- new preview database, a restore) got a gold price feature that could not work.
--
-- The write path already failed loudly on such a database; the read path used to
-- swallow the error and return null, so it merely looked like "no price set"
-- until #533 made it fail closed and the 500 surfaced the real cause.
--
-- `if not exists` so this is a no-op wherever the column was already added by
-- hand — the point is to make the migration set reproduce the real schema, not
-- to change any environment that already matches it.
--
-- Deliberately nullable with no default: null means "no prior price to compare
-- against", which is exactly the state of a user's first refresh, and the
-- endpoint already renders that as "no change" rather than a 0% move.

alter table public.gold_price_settings
  add column if not exists previous_price_per_chi numeric;

comment on column public.gold_price_settings.previous_price_per_chi is
  'Price per chi before the most recent refresh; null on a user''s first refresh. Read by GET /api/v1/gold-price and written by POST /api/v1/gold-price/refresh to show the change since last sync.';
