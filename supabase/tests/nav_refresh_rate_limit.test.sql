-- Rate-limit RPC hardening for the NAV refresh fan-out (#515).
--
-- The endpoint's cap is only as strong as the RPC behind it. This asserts the
-- three properties the API-layer tests can't reach (they mock the RPC):
--   1) the policy is enforced server-side — the no-arg function blocks the 6th
--      call in a window (5 allowed / 60 s, hardcoded);
--   2) the old parameterized (int, int) overload — which a client could call
--      with a 0-second window to reset its own counter — no longer exists;
--   3) anon / PUBLIC cannot execute it; only authenticated can.
--
-- now() is the transaction timestamp (constant here), so the window never rolls
-- over mid-test and the count climbs monotonically — exactly what we want to
-- drive the 6th call over the limit. True concurrency (two sessions racing the
-- same counter) can't be exercised from a single rolled-back transaction; that
-- guarantee comes from the atomic INSERT … ON CONFLICT DO UPDATE (row lock).
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_allowed boolean;
  v_retry int;
  i int;
begin
  -- 2) The bypassable (int, int) overload must be gone; the no-arg one present.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_nav_refresh_rate_limit' and p.pronargs = 2
  ) then
    raise exception 'the old (int, int) overload must not exist';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_nav_refresh_rate_limit' and p.pronargs = 0
  ) then
    raise exception 'the no-arg check_nav_refresh_rate_limit() must exist';
  end if;

  -- 3) Only authenticated may execute it.
  if has_function_privilege('anon', 'public.check_nav_refresh_rate_limit()', 'execute') then
    raise exception 'anon must not have EXECUTE on the rate-limit RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.check_nav_refresh_rate_limit()', 'execute') then
    raise exception 'authenticated must have EXECUTE on the rate-limit RPC';
  end if;

  -- 1) Server-side policy: 5 allowed then blocked, scoped to auth.uid().
  insert into auth.users (id, email) values (gen_random_uuid(), 'nav-rl@test.invalid') returning id into v_user;
  -- Make auth.uid() resolve to our test user (both GUC spellings, for
  -- compatibility across auth.uid() implementations).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  for i in 1..5 loop
    select allowed into v_allowed from public.check_nav_refresh_rate_limit();
    if not v_allowed then
      raise exception 'call % of 5 should be allowed within the window', i;
    end if;
  end loop;

  select allowed, retry_after_seconds into v_allowed, v_retry from public.check_nav_refresh_rate_limit();
  if v_allowed then
    raise exception 'the 6th call in the window must be blocked';
  end if;
  if v_retry <= 0 then
    raise exception 'a blocked call must report a positive retry_after_seconds';
  end if;

  raise notice 'nav_refresh_rate_limit.test.sql: OK';
end $$;

rollback;
