-- Atomic gold-price refresh (#528).
--
-- The route used to read the current price, then upsert the new one in a second
-- statement. Two failure modes lived in that gap: the read's error was dropped,
-- so a transient failure wrote previous_price_per_chi = null and silently erased
-- the comparison point; and a concurrent refresh landing between the two
-- statements produced a mismatched previous/current pair.
--
-- refresh_gold_price collapses both into one INSERT … ON CONFLICT DO UPDATE.
-- There is no separate read to fail, and the conflicting insert takes a row lock
-- on the existing row, so two concurrent refreshes serialize: the second sees
-- the first's committed price as its previous. Inside the DO UPDATE,
-- `gold_price_settings.price_per_chi` is the row as it stands *before* this
-- statement and `excluded` is the incoming value — that is what makes the
-- carry-over atomic rather than read-then-write.
--
-- True concurrency (two sessions racing the same row) can't be driven from a
-- single rolled-back transaction; that guarantee comes from the row lock above.
-- What is asserted here is the semantics the lock protects: the carry-over
-- chain, the first-refresh null, and per-user isolation.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user  uuid;
  v_other uuid;
  v_price numeric;
  v_prev  numeric;
  v_rows  int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'gold-atomic@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'gold-other@test.invalid') returning id into v_other;

  -- The function is scoped to auth.uid(); make it resolve to our test user.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 1) First refresh: creates the row, no prior price to carry over.
  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.refresh_gold_price(8500000);
  if v_price <> 8500000 then
    raise exception 'first refresh must return the new price, got %', v_price;
  end if;
  if v_prev is not null then
    raise exception 'first refresh must leave previous null, got %', v_prev;
  end if;

  -- 2) Second refresh: the old current becomes previous, atomically.
  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.refresh_gold_price(8600000);
  if v_price <> 8600000 or v_prev <> 8500000 then
    raise exception 'second refresh must carry 8500000 over, got price=% previous=%', v_price, v_prev;
  end if;

  -- 3) The chain keeps moving — previous always tracks the immediately prior price.
  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.refresh_gold_price(8400000);
  if v_price <> 8400000 or v_prev <> 8600000 then
    raise exception 'third refresh must carry 8600000 over, got price=% previous=%', v_price, v_prev;
  end if;

  -- 4) Still exactly one row per user — the upsert must never accumulate rows.
  select count(*) into v_rows from public.gold_price_settings where user_id = v_user;
  if v_rows <> 1 then
    raise exception 'expected exactly one settings row per user, got %', v_rows;
  end if;

  -- 5) The persisted row matches what the function returned (no drift between
  --    the RETURNING projection and the stored row).
  select price_per_chi, previous_price_per_chi into v_price, v_prev
  from public.gold_price_settings where user_id = v_user;
  if v_price <> 8400000 or v_prev <> 8600000 then
    raise exception 'stored row disagrees with the returned row: price=% previous=%', v_price, v_prev;
  end if;

  -- 6) Scoped to the caller: another user's settings are untouched. The function
  --    takes no user_id, so there is no parameter to point at a foreign row.
  select count(*) into v_rows from public.gold_price_settings where user_id = v_other;
  if v_rows <> 0 then
    raise exception 'refresh must not create a row for another user, got % rows', v_rows;
  end if;

  -- 7) An unauthenticated caller must not be able to write anything.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.refresh_gold_price(9000000);
    raise exception 'refresh_gold_price must reject an unauthenticated caller';
  exception
    when insufficient_privilege then
      null; -- expected
  end;

  raise notice 'gold_refresh_atomic.test.sql: OK';
end $$;

rollback;
