-- A matured deposit can move into several funds at once.
--
-- park_dca_lines_in_deposit (20261003000002) parks several DCA lines in one
-- deposit, with no single target fund: each parked line records its share. At
-- maturity the money goes back into those funds, split as the user enters it
-- (the app suggests the split by share). move_deposit_to_fund (20261001000001)
-- takes one fund.
--
-- move_deposit_to_funds(deposit, legs, date) writes one pair per leg, exactly
-- the pair move_deposit_to_fund writes: a purchase of the fund with that leg's
-- payout, and a withdrawal naming it (moved_to_fund_tx_id), so neither half
-- can be undone alone. Deleting one purchase takes its withdrawal with it and
-- puts that slice back in the deposit; the other legs stay.
--
-- The principal is sliced across the legs in proportion to their payouts, the
-- last leg taking the remainder, so the slices always sum to exactly what was
-- left to close. Every check move_deposit_to_fund made still applies, once for
-- the deposit and per leg for the funds.
--
-- move_deposit_to_fund becomes the one-leg call of it.
--
-- Covered by supabase/tests/move_deposit_to_funds.test.sql and
-- move_deposit_to_fund.test.sql (`npm run test:db`).

-- legs: [{ "fund_id": uuid, "received_vnd": bigint, "units": numeric, "unit_price": numeric }, ...]
-- returns: [{ "withdrawal_id": uuid, "purchase_id": uuid }, ...] in leg order.
create or replace function public.move_deposit_to_funds(
  p_deposit_id uuid,
  p_legs jsonb,
  p_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dep       public.investment_transactions;
  v_date      date;
  v_remaining bigint;
  v_n         int;
  v_total     numeric := 0;
  v_sliced    bigint := 0;
  v_slice     bigint;
  v_leg       jsonb;
  v_idx       int := 0;
  v_fund      uuid;
  v_received  bigint;
  v_units     numeric;
  v_price     numeric;
  v_purchase  uuid;
  v_wd        uuid;
  v_out       jsonb := '[]'::jsonb;
begin
  if p_deposit_id is null then
    raise exception 'move to fund: name the deposit and the fund'
      using errcode = 'check_violation';
  end if;
  if p_legs is null or jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) = 0 then
    raise exception 'move to fund: name at least one fund to move into'
      using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(p_legs);

  -- Per leg, before anything is read or written.
  for v_leg in select value from jsonb_array_elements(p_legs) loop
    if (v_leg ->> 'fund_id') is null then
      raise exception 'move to fund: name the deposit and the fund'
        using errcode = 'check_violation';
    end if;
    v_received := (v_leg ->> 'received_vnd')::bigint;
    v_units    := (v_leg ->> 'units')::numeric;
    v_price    := (v_leg ->> 'unit_price')::numeric;
    if v_received is null or v_received <= 0 then
      raise exception 'move to fund: the amount received must be positive'
        using errcode = 'check_violation';
    end if;
    if v_units is null or v_units <= 0 or v_price is null or v_price <= 0 then
      raise exception 'move to fund: the purchase needs positive units and NAV'
        using errcode = 'check_violation';
    end if;
    v_total := v_total + v_received;
  end loop;
  if (select count(distinct value ->> 'fund_id') from jsonb_array_elements(p_legs)) <> v_n then
    raise exception 'move to fund: a fund is named more than once'
      using errcode = 'check_violation';
  end if;

  select * into v_dep
    from public.investment_transactions
   where transaction_id = p_deposit_id
   for update;
  if not found then
    raise exception 'move to fund: the deposit was not found'
      using errcode = 'no_data_found';
  end if;

  -- A plain, live, single bank term deposit — the same shape renew_term_deposit
  -- rolls forward (as 20261001000001).
  if v_dep.transaction_type is distinct from 'investment' or v_dep.asset_type is distinct from 'bank' then
    raise exception 'move to fund: only a bank deposit can be moved to a fund'
      using errcode = 'check_violation';
  end if;
  if v_dep.deposit_group_id is not null then
    raise exception 'move to fund: an accumulating book cannot be moved to a fund'
      using errcode = 'check_violation';
  end if;
  if v_dep.renewed_from_transaction_id is not null then
    raise exception 'move to fund: a renewal snapshot is already closed'
      using errcode = 'check_violation';
  end if;
  if v_dep.interest_rate is null or v_dep.expiry_date is null then
    raise exception 'move to fund: only a term deposit has a maturity to move at'
      using errcode = 'check_violation';
  end if;
  if coalesce(v_dep.is_pledged, false) then
    raise exception 'move to fund: a pledged deposit is frozen as collateral'
      using errcode = 'check_violation';
  end if;

  v_date := coalesce(p_date, public.business_today());
  if v_date > public.business_today() then
    raise exception 'move to fund: the move cannot be dated in the future'
      using errcode = 'check_violation';
  end if;
  if v_date < v_dep.expiry_date - 1 then
    raise exception 'move to fund: the deposit has not matured yet'
      using errcode = 'check_violation';
  end if;

  if (select count(*) from public.funds
       where user_id = v_dep.user_id
         and id in (select (value ->> 'fund_id')::uuid from jsonb_array_elements(p_legs))) <> v_n then
    raise exception 'move to fund: the fund does not belong to this deposit''s owner'
      using errcode = 'insufficient_privilege';
  end if;

  -- What is left to close, with the bucket precedence check_withdrawal_balance
  -- applies (as 20261001000001).
  select v_dep.amount_vnd - coalesce(sum(w.principal_withdrawn), 0)
    into v_remaining
    from public.investment_transactions w
   where w.parent_transaction_id = p_deposit_id
     and w.transaction_type = 'withdrawal'
     and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false);
  if v_remaining <= 0 then
    raise exception 'move to fund: the deposit is already closed'
      using errcode = 'check_violation';
  end if;
  -- Every leg closes a positive slice.
  if v_remaining < v_n then
    raise exception 'move to fund: too little is left in the deposit to split across % funds', v_n
      using errcode = 'check_violation';
  end if;

  -- The ×10 sanity bound on a client's "received" (20260620000006), on the total.
  if v_total > v_remaining * 10 then
    raise exception 'move to fund: the amount received is far more than the deposit holds'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.deposit_move_write', '1', true);
  for v_leg in select value from jsonb_array_elements(p_legs) loop
    v_idx      := v_idx + 1;
    v_fund     := (v_leg ->> 'fund_id')::uuid;
    v_received := (v_leg ->> 'received_vnd')::bigint;

    -- The principal slice, in proportion to this leg's payout; the last leg
    -- takes what is left so the slices sum to v_remaining exactly. At least 1,
    -- with the room for the legs still to come kept.
    if v_idx = v_n then
      v_slice := v_remaining - v_sliced;
    else
      v_slice := greatest(1, least(
        floor(v_remaining::numeric * v_received / v_total)::bigint,
        v_remaining - v_sliced - (v_n - v_idx)));
    end if;
    v_sliced := v_sliced + v_slice;

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, fund_id,
      investment_date, amount_vnd, units, unit_price, units_estimated
    ) values (
      v_dep.user_id, v_dep.goal_id, 'fund', 'investment', v_fund,
      v_date, v_received, (v_leg ->> 'units')::numeric, (v_leg ->> 'unit_price')::numeric, true
    )
    returning transaction_id into v_purchase;

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
      investment_date, amount_vnd, principal_withdrawn, affects_progress,
      moved_to_fund_tx_id
    ) values (
      v_dep.user_id, v_dep.goal_id, 'bank', 'withdrawal', p_deposit_id,
      v_date, v_received, v_slice, true,
      v_purchase
    )
    returning transaction_id into v_wd;

    v_out := v_out || jsonb_build_array(jsonb_build_object('withdrawal_id', v_wd, 'purchase_id', v_purchase));
  end loop;
  perform set_config('app.deposit_move_write', '', true);

  return v_out;
end;
$$;

revoke all on function public.move_deposit_to_funds(uuid, jsonb, date) from public, anon;
grant execute on function public.move_deposit_to_funds(uuid, jsonb, date) to authenticated, service_role;

-- ── move_deposit_to_fund: the one-leg call ───────────────────────────────────
create or replace function public.move_deposit_to_fund(
  p_deposit_id uuid,
  p_received_vnd bigint,
  p_fund_id uuid,
  p_units numeric,
  p_unit_price numeric,
  p_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_fund_id is null then
    raise exception 'move to fund: name the deposit and the fund'
      using errcode = 'check_violation';
  end if;
  return public.move_deposit_to_funds(
    p_deposit_id,
    jsonb_build_array(jsonb_build_object(
      'fund_id', p_fund_id, 'received_vnd', p_received_vnd,
      'units', p_units, 'unit_price', p_unit_price)),
    p_date
  ) -> 0;
end;
$$;
