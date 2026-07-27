-- gold_price_settings.previous_price_per_chi must exist in the migration set.
--
-- The column was never created by any migration — 20260325000001 defines only
-- (user_id, price_per_chi, updated_at) — yet three code paths depend on it:
-- the gold-price GET selects it, and the refresh POST both writes and selects
-- it. It exists on the hosted project (added out of band), so the drift stayed
-- invisible there while every environment rebuilt from migrations — a fresh
-- local stack, a new preview database, a restore — got a broken gold price.
--
-- The write path already failed loudly on such a database ("Failed to save gold
-- price"); the read path used to swallow the error and return null, so it looked
-- like "no price set" instead. Failing closed (#533) turned that into a visible
-- 500, which is what surfaced the drift.
--
-- This test asserts the schema contract those three code paths actually rely on:
-- the column exists, is numeric, and is nullable (the first refresh for a user
-- writes previous = null). Exercised the way the app uses it — insert, then
-- read back — rather than by inspecting the catalog alone, so it fails for the
-- same reason the endpoint would.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_prev numeric;
  v_is_nullable text;
  v_type text;
begin
  select data_type, is_nullable into v_type, v_is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'gold_price_settings'
    and column_name = 'previous_price_per_chi';

  if v_type is null then
    raise exception 'gold_price_settings.previous_price_per_chi is missing — the migrations do not match what the gold-price endpoints read';
  end if;
  if v_type <> 'numeric' then
    raise exception 'previous_price_per_chi must be numeric, got %', v_type;
  end if;
  -- The very first refresh for a user has no prior price to carry over.
  if v_is_nullable <> 'YES' then
    raise exception 'previous_price_per_chi must be nullable so a first refresh can store a null previous price';
  end if;

  insert into auth.users (id, email) values (gen_random_uuid(), 'gold-prev@test.invalid') returning id into v_user;

  -- First refresh: no previous price yet.
  insert into public.gold_price_settings (user_id, price_per_chi, previous_price_per_chi, updated_at)
  values (v_user, 8500000, null, now());

  select previous_price_per_chi into v_prev
  from public.gold_price_settings where user_id = v_user;
  if v_prev is not null then
    raise exception 'a first refresh must store a null previous price, got %', v_prev;
  end if;

  -- Second refresh: the old current price becomes the previous one.
  update public.gold_price_settings
  set previous_price_per_chi = price_per_chi, price_per_chi = 8600000, updated_at = now()
  where user_id = v_user;

  select previous_price_per_chi into v_prev
  from public.gold_price_settings where user_id = v_user;
  if v_prev <> 8500000 then
    raise exception 'the prior price must carry over to previous_price_per_chi, got %', v_prev;
  end if;

  raise notice 'gold_price_previous_column.test.sql: OK';
end $$;

rollback;
