-- Atomic bulk gold-price refresh for the daily cron (#547).
--
-- The two fixtures deliberately start with different prices. One call must move
-- each row's own current value into previous_price_per_chi while applying the
-- shared scraped price, proving the operation is not a read-then-write loop.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user_a uuid;
  v_user_b uuid;
  v_updated integer;
  v_price numeric;
  v_prev numeric;
begin
  -- This function updates every user's row. Only the service role used by the
  -- authenticated cron route may execute it.
  if has_function_privilege('anon', 'public.refresh_gold_price_all(numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refresh_gold_price_all(numeric)', 'EXECUTE') then
    raise exception 'end-user roles must not execute the bulk gold refresh';
  end if;
  if not has_function_privilege('service_role', 'public.refresh_gold_price_all(numeric)', 'EXECUTE') then
    raise exception 'service_role must be able to execute the bulk gold refresh';
  end if;

  -- Isolate the returned row count from any persistent local test fixtures. The
  -- surrounding transaction restores them at rollback.
  delete from public.gold_price_settings;

  insert into auth.users (id, email)
    values (gen_random_uuid(), 'gold-cron-a@test.invalid')
    returning id into v_user_a;
  insert into auth.users (id, email)
    values (gen_random_uuid(), 'gold-cron-b@test.invalid')
    returning id into v_user_b;

  insert into public.gold_price_settings (user_id, price_per_chi, previous_price_per_chi)
  values
    (v_user_a, 8500000, 8400000),
    (v_user_b, 8300000, null);

  -- One bulk statement updates both users while preserving each distinct prior
  -- current value.
  select public.refresh_gold_price_all(8700000) into v_updated;
  if v_updated <> 2 then
    raise exception 'expected two updated rows, got %', v_updated;
  end if;

  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.gold_price_settings where user_id = v_user_a;
  if v_price <> 8700000 or v_prev <> 8500000 then
    raise exception 'user A chain is wrong: current=% previous=%', v_price, v_prev;
  end if;

  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.gold_price_settings where user_id = v_user_b;
  if v_price <> 8700000 or v_prev <> 8300000 then
    raise exception 'user B chain is wrong: current=% previous=%', v_price, v_prev;
  end if;

  -- An unchanged scrape is still an observation. Both fields become equal so a
  -- consumer can render a truthful 0% change, matching the manual refresh.
  select public.refresh_gold_price_all(8700000) into v_updated;
  if v_updated <> 2 then
    raise exception 'unchanged refresh must still report two rows, got %', v_updated;
  end if;

  if exists (
    select 1 from public.gold_price_settings
    where price_per_chi <> 8700000
       or previous_price_per_chi <> 8700000
  ) then
    raise exception 'unchanged refresh did not record a 0%% change';
  end if;

  -- Invalid scraped values must not destroy the last good pair.
  begin
    perform public.refresh_gold_price_all(0);
    raise exception 'zero price must be rejected';
  exception
    when check_violation then
      null; -- expected
  end;

  if exists (
    select 1 from public.gold_price_settings
    where price_per_chi <> 8700000
       or previous_price_per_chi <> 8700000
  ) then
    raise exception 'invalid refresh changed stored prices';
  end if;

  raise notice 'gold_refresh_cron_atomic.test.sql: OK';
end $$;

rollback;
