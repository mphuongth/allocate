-- `funds.fund_type` admits 'etf' (20260918000001).
--
-- An ETF certificate is a fund holding in every way this app already models —
-- bought in units, valued as units × price, sold in part, assigned to a goal —
-- so it rides the `funds` table rather than a new asset type. The one thing the
-- database has to say is that 'etf' is a legal type; everything else about an
-- ETF (its price comes from the exchange, not from Fmarket) is application code.
--
-- The negative case matters as much as the positive one: the point of the CHECK
-- is that a typo'd or invented type is refused, so widening it must not widen it
-- to anything. And the four pre-existing types are re-asserted because a
-- drop-and-recreate of the constraint is exactly the shape of change that
-- silently loses one of them.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_owner  uuid := gen_random_uuid();
  v_type   text;
  v_failed boolean;
begin
  insert into auth.users (id, email) values (v_owner, 'fund-type-etf@test.invalid');

  -- ── An ETF is a legal fund type ────────────────────────────────────────────
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_owner, 'DCVFM VN DIAMOND ETF', 'FUEVFVND', 'etf', 34380);

  select fund_type into v_type
    from public.funds where user_id = v_owner and code = 'FUEVFVND';

  if v_type is distinct from 'etf' then
    raise exception 'an ETF fund stored its type as % rather than etf', v_type;
  end if;

  -- ── …and the open-ended types it joins are all still legal ─────────────────
  foreach v_type in array array['balanced', 'equity', 'debt', 'gold'] loop
    insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_owner, 'A ' || v_type || ' fund', upper(v_type), v_type, 1.2345);
  end loop;

  -- ── Widening the type is not opening it ────────────────────────────────────
  v_failed := false;
  begin
    insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_owner, 'Not a fund type', 'NOPE', 'etfs', 1);
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an invented fund type was accepted';
  end if;

  raise notice 'fund_type_etf: OK';
end $$;

rollback;
