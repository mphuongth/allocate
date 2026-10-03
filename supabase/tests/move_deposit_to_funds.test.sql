-- A matured deposit moves into SEVERAL funds at once (20261003000003).
--
-- A deposit that parked several DCA lines (park_dca_lines_in_deposit) goes back
-- into those funds at maturity, split by what the user enters per fund. Each
-- fund is one pair, exactly as move_deposit_to_fund writes one: a purchase of
-- the fund with that leg's payout, and a withdrawal closing that leg's slice of
-- the principal, linked so neither half can be undone alone.
--
-- What has to hold:
--
--   • the slices of principal sum to exactly what was left in the deposit, so
--     it closes in full — however the payout divides (rounding included);
--   • each withdrawal's cash is its own purchase's amount: money out of the
--     deposit = money into that fund;
--   • every purchase stays in the deposit's goal;
--   • a refused move writes nothing;
--   • move_deposit_to_fund is the one-leg call of it and behaves as before.
--
-- Exercised AS THE USER (role authenticated + JWT subject).
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_today   date := public.business_today();
  v_f1      uuid;
  v_f2      uuid;
  v_f3      uuid;
  v_ofund   uuid;
  v_dep     uuid;  -- 5,000,000 matured, Unallocated, three funds
  v_tiny    uuid;  -- 100 matured, for the rounding split
  v_young   uuid;  -- not matured
  v_res     jsonb;
  v_count   int;
  v_sum     bigint;
  v_left    bigint;
  v_failed  boolean;
  v_buy     uuid;
begin
  insert into auth.users (id, email) values (v_user, 'move-to-funds@test.invalid');
  insert into auth.users (id, email) values (v_other, 'move-to-funds-other@test.invalid');

  insert into public.funds (user_id, name, code, fund_type, nav) values (v_user, 'F1', 'F1', 'equity', 10000) returning id into v_f1;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_user, 'F2', 'F2', 'equity', 20000) returning id into v_f2;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_user, 'F3', 'F3', 'equity', 25000) returning id into v_f3;
  insert into public.funds (user_id, name, code, fund_type, nav) values (v_other, 'Theirs', 'THR', 'equity', 10000) returning id into v_ofund;

  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, 'bank', 'investment', v_today - 182, 5000000, 6, v_today - 1)
  returning transaction_id into v_dep;

  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, 'bank', 'investment', v_today - 182, 100, 6, v_today)
  returning transaction_id into v_tiny;

  insert into public.investment_transactions
    (user_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, 'bank', 'investment', v_today - 30, 1000000, 6, v_today + 60)
  returning transaction_id into v_young;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ── 1) refusals first, so the deposit is untouched when they run ─────────
  foreach v_res in array array[
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('fund_id', v_f1, 'received_vnd', 0, 'units', 0, 'unit_price', 10000)),
    jsonb_build_array(
      jsonb_build_object('fund_id', v_f1, 'received_vnd', 1000, 'units', 0.1, 'unit_price', 10000),
      jsonb_build_object('fund_id', v_f1, 'received_vnd', 1000, 'units', 0.1, 'unit_price', 10000))
  ] loop
    v_failed := false;
    begin
      perform public.move_deposit_to_funds(v_dep, v_res, v_today);
    exception when check_violation then v_failed := true;
    end;
    if not v_failed then raise exception 'must refuse legs %', v_res; end if;
  end loop;

  v_failed := false;
  begin
    perform public.move_deposit_to_funds(v_dep, jsonb_build_array(
      jsonb_build_object('fund_id', v_f1, 'received_vnd', 1000000, 'units', 100, 'unit_price', 10000),
      jsonb_build_object('fund_id', v_ofund, 'received_vnd', 1000000, 'units', 100, 'unit_price', 10000)), v_today);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'someone else''s fund must be refused'; end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_funds(v_young, jsonb_build_array(
      jsonb_build_object('fund_id', v_f1, 'received_vnd', 1000000, 'units', 100, 'unit_price', 10000)), v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a deposit that has not matured must not move'; end if;

  select count(*) into v_count from public.investment_transactions where parent_transaction_id = v_dep;
  if v_count <> 0 then raise exception 'a refused move must write nothing, % rows', v_count; end if;

  -- ── 2) three funds: three pairs, the principal closed in full ────────────
  v_res := public.move_deposit_to_funds(v_dep, jsonb_build_array(
    jsonb_build_object('fund_id', v_f1, 'received_vnd', 1030000, 'units', 103, 'unit_price', 10000),
    jsonb_build_object('fund_id', v_f2, 'received_vnd', 1545000, 'units', 77.25, 'unit_price', 20000),
    jsonb_build_object('fund_id', v_f3, 'received_vnd', 2575000, 'units', 103, 'unit_price', 25000)), v_today);

  if jsonb_array_length(v_res) <> 3 then raise exception 'one pair per fund expected, got %', v_res; end if;

  select count(*), sum(w.principal_withdrawn) into v_count, v_sum
    from public.investment_transactions w
   where w.parent_transaction_id = v_dep and w.transaction_type = 'withdrawal';
  if v_count <> 3 or v_sum <> 5000000 then
    raise exception 'the slices must close the whole 5,000,000, got % withdrawals summing %', v_count, v_sum;
  end if;

  select count(*) into v_count
    from public.investment_transactions w
    join public.investment_transactions p on p.transaction_id = w.moved_to_fund_tx_id
   where w.parent_transaction_id = v_dep
     and p.asset_type = 'fund' and p.amount_vnd = w.amount_vnd and p.goal_id is null and p.units_estimated;
  if v_count <> 3 then raise exception 'each withdrawal must pay for its own purchase, same money, same goal'; end if;

  if not exists (select 1 from public.investment_transactions
                  where fund_id = v_f2 and asset_type = 'fund' and amount_vnd = 1545000 and units = 77.25 and unit_price = 20000) then
    raise exception 'each purchase carries its own units and NAV';
  end if;
  -- Principal sliced in proportion to the payout: F1 got 1,030,000 of 5,150,000.
  if not exists (select 1 from public.investment_transactions w
                   join public.investment_transactions p on p.transaction_id = w.moved_to_fund_tx_id
                  where p.fund_id = v_f1 and w.principal_withdrawn = 1000000) then
    raise exception 'F1''s slice of principal must be 1,000,000';
  end if;

  v_failed := false;
  begin
    perform public.move_deposit_to_funds(v_dep, jsonb_build_array(
      jsonb_build_object('fund_id', v_f1, 'received_vnd', 1000, 'units', 0.1, 'unit_price', 10000)), v_today);
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a closed deposit must not move again'; end if;

  -- ── 3) undo one fund: its pair goes, the others stay ─────────────────────
  select p.transaction_id into v_buy
    from public.investment_transactions w
    join public.investment_transactions p on p.transaction_id = w.moved_to_fund_tx_id
   where w.parent_transaction_id = v_dep and p.fund_id = v_f3;
  delete from public.investment_transactions where transaction_id = v_buy;
  select count(*), coalesce(sum(principal_withdrawn), 0) into v_count, v_sum
    from public.investment_transactions where parent_transaction_id = v_dep and transaction_type = 'withdrawal';
  if v_count <> 2 then raise exception 'deleting one purchase must take only its own withdrawal, % left', v_count; end if;
  v_left := 5000000 - v_sum;
  if v_left <= 0 then raise exception 'the undone slice must be back in the deposit'; end if;

  -- ── 4) rounding: 100 split three ways still closes exactly 100 ───────────
  perform public.move_deposit_to_funds(v_tiny, jsonb_build_array(
    jsonb_build_object('fund_id', v_f1, 'received_vnd', 1, 'units', 0.0001, 'unit_price', 10000),
    jsonb_build_object('fund_id', v_f2, 'received_vnd', 1, 'units', 0.0001, 'unit_price', 20000),
    jsonb_build_object('fund_id', v_f3, 'received_vnd', 1, 'units', 0.0001, 'unit_price', 25000)), v_today);
  select sum(principal_withdrawn) into v_sum from public.investment_transactions where parent_transaction_id = v_tiny;
  if v_sum <> 100 then raise exception 'rounded slices must sum to the principal, got %', v_sum; end if;

  raise notice 'move_deposit_to_funds.test.sql: OK';
end $$;

rollback;
