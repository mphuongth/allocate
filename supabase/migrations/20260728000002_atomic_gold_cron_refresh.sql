-- Keep the daily gold cron's current/previous pair atomic (#547).
--
-- The user-scoped refresh_gold_price function already moves the current value
-- into previous_price_per_chi in the same statement that stores the new value.
-- The cron instead updated only price_per_chi, so every daily run left
-- previous_price_per_chi pointing at an increasingly old manual refresh.
--
-- This bulk counterpart is invoked only by the service-role cron. One UPDATE
-- performs both assignments, taking the normal row lock on every affected row.
-- A concurrent manual refresh and cron refresh therefore serialize per user,
-- and whichever lands last observes the value written immediately before it.
--
-- An unchanged quote is still a successful observation: current is moved to
-- previous and then written back as current, producing a truthful 0% change.
-- This matches refresh_gold_price rather than giving manual and cron refreshes
-- different meanings.

create or replace function public.refresh_gold_price_all(p_price numeric)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_price is null or p_price <= 0 then
    raise exception 'refresh_gold_price_all requires a positive price, got %', p_price
      using errcode = 'check_violation';
  end if;

  update public.gold_price_settings
     set previous_price_per_chi = price_per_chi,
         price_per_chi          = p_price,
         updated_at             = now()
   where user_id is not null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- The function updates every user's row, so it must never be callable through
-- an end-user token. It remains SECURITY INVOKER (the default): only the
-- service_role, which already owns the cron's bulk-write capability, can run it.
revoke all on function public.refresh_gold_price_all(numeric) from public;
revoke all on function public.refresh_gold_price_all(numeric) from anon;
revoke all on function public.refresh_gold_price_all(numeric) from authenticated;
grant execute on function public.refresh_gold_price_all(numeric) to service_role;

comment on function public.refresh_gold_price_all(numeric) is
  'Atomically refresh every existing gold-price row for the service-role cron, moving current to previous first. An unchanged quote records a 0% change.';
