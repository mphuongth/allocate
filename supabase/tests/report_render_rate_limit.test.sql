-- Per-user render budget for the PDF portfolio report (#594).
--
-- POST /api/v1/report renders a PDF server-side — the most expensive operation
-- an authenticated user can trigger — and had no limit of any kind.
--
-- Mirrors the gold-refresh (20260727000004) and NAV (20260725000001) limiters in
-- shape, with its own counter and policy so the three can be tuned separately.
--
-- Asserts the three properties the route tests can't reach (they mock the RPC):
--   1) the policy is enforced server-side, hardcoded, not passed in;
--   2) counters are per user, so one account can't exhaust another's budget;
--   3) anon cannot execute it; only authenticated can.
--
-- now() is the transaction timestamp (constant here), so the window never rolls
-- over mid-test and the count climbs monotonically. True concurrency can't be
-- driven from a single rolled-back transaction; that guarantee comes from the
-- atomic INSERT … ON CONFLICT DO UPDATE row lock, the same as the other two.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_other   uuid;
  v_allowed boolean;
  v_retry   int;
  i         int;
begin
  -- 1) No parameterized overload: a caller who can execute the function must not
  --    be able to hand it a degenerate window and reset their own counter.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'check_report_render_rate_limit' and p.pronargs > 0
  ) then
    raise exception 'check_report_render_rate_limit must take no arguments';
  end if;

  -- 2) anon must not be able to call it at all.
  if has_function_privilege('anon', 'public.check_report_render_rate_limit()', 'execute') then
    raise exception 'anon must not be able to execute check_report_render_rate_limit';
  end if;
  if not has_function_privilege('authenticated', 'public.check_report_render_rate_limit()', 'execute') then
    raise exception 'authenticated must be able to execute check_report_render_rate_limit';
  end if;

  insert into auth.users (id, email) values (gen_random_uuid(), 'report-rl@test.invalid') returning id into v_user;
  insert into auth.users (id, email) values (gen_random_uuid(), 'report-rl2@test.invalid') returning id into v_other;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  -- 3) The budget is spendable up to the cap.
  for i in 1..10 loop
    select allowed into v_allowed from public.check_report_render_rate_limit();
    if not v_allowed then
      raise exception 'call % of 10 should be allowed within the window', i;
    end if;
  end loop;

  -- 4) …and the next one is refused, with a usable Retry-After.
  select allowed, retry_after_seconds into v_allowed, v_retry from public.check_report_render_rate_limit();
  if v_allowed then
    raise exception 'the 11th call in the window must be blocked';
  end if;
  if v_retry <= 0 then
    raise exception 'a blocked call must report a positive retry_after_seconds, got %', v_retry;
  end if;

  -- 5) The counter is per user: a second account starts with a full budget even
  --    though the first is currently blocked.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_other::text, true);

  select allowed into v_allowed from public.check_report_render_rate_limit();
  if not v_allowed then
    raise exception 'a different user must not inherit the first user''s exhausted budget';
  end if;

  -- 6) An unauthenticated caller is refused rather than sharing a null-owner row.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  select allowed into v_allowed from public.check_report_render_rate_limit();
  if v_allowed then
    raise exception 'an unauthenticated caller must not be allowed';
  end if;

  raise notice 'report_render_rate_limit.test.sql: OK';
end $$;

rollback;
