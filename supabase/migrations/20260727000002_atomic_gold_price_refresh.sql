-- Atomic gold-price refresh (#528).
--
-- The route read the current price, then upserted the new one in a second
-- statement, carrying the value it had just read into previous_price_per_chi.
-- Two failure modes lived in that gap:
--
--   • the read's error was discarded, so a transient failure wrote
--     previous_price_per_chi = null — the comparison point silently erased while
--     the endpoint still returned 200. The read also used .single(), which
--     reports a genuinely absent row as an error, so "first refresh" and
--     "database failure" were indistinguishable;
--   • a concurrent refresh landing between the two statements produced a
--     mismatched previous/current pair (both writers carry the same stale
--     "previous", or the later write wins with an older price).
--
-- One INSERT … ON CONFLICT DO UPDATE collapses both. There is no separate read
-- left to fail, and the conflicting insert takes a row lock on the existing row,
-- so two concurrent refreshes serialize — the second observes the first's
-- committed price as its previous. Inside DO UPDATE, `g.price_per_chi` is the
-- row as it stands before this statement and `excluded` is the incoming value;
-- that is what makes the carry-over atomic rather than read-then-write.
--
-- SECURITY DEFINER with auth.uid() resolved inside the function: the price is
-- the only parameter, so there is no user_id a caller could point at someone
-- else's row. An unauthenticated caller is rejected outright rather than
-- inserting a null-owner row.

create or replace function public.refresh_gold_price(p_price numeric)
returns table (
  price_per_chi numeric,
  previous_price_per_chi numeric,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_now  timestamptz := now();
begin
  if v_user is null then
    raise exception 'refresh_gold_price requires an authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- A price of zero or below is not a quote — refuse it rather than overwrite a
  -- good price and lose the previous one to the carry-over.
  if p_price is null or p_price <= 0 then
    raise exception 'refresh_gold_price requires a positive price, got %', p_price
      using errcode = 'check_violation';
  end if;

  return query
  insert into public.gold_price_settings as g (user_id, price_per_chi, previous_price_per_chi, updated_at)
  values (v_user, p_price, null, v_now)
  on conflict (user_id) do update
    set previous_price_per_chi = g.price_per_chi,
        price_per_chi          = excluded.price_per_chi,
        updated_at             = excluded.updated_at
  returning g.price_per_chi, g.previous_price_per_chi, g.updated_at;
end;
$$;

-- EXECUTE is granted to PUBLIC by default; revoke it (covering anon and
-- authenticated) and re-grant only to authenticated. anon is revoked explicitly
-- in case a prior grant targeted it directly.
revoke all on function public.refresh_gold_price(numeric) from public;
revoke all on function public.refresh_gold_price(numeric) from anon;
grant execute on function public.refresh_gold_price(numeric) to authenticated;

comment on function public.refresh_gold_price(numeric) is
  'Atomically store a new gold price for auth.uid(), moving the prior price to previous_price_per_chi in the same statement. Backs POST /api/v1/gold-price/refresh.';
