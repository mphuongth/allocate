-- A pledged deposit takes no merge (#635).
--
-- "Not pledged" is rule 5 of the merge ruleset (lib/mergeEligibility), and it
-- used to guard one side only: classifyMergeSource read source.isPledged and
-- nothing read the ANCHOR's. So cash could be folded INTO collateral — it lands
-- inside a balance the user cannot withdraw until the pledge is released, and
-- nothing in the flow said so, while the "Bộ luật" card presented "not pledged"
-- as a property of the merge rather than of one side of it.
--
-- The UI now refuses both directions. The database says the same thing, because
-- the raw API reaches these rows directly: RLS lets `authenticated` write its own
-- investment_transactions, and no merge RPC mentions is_pledged at all
-- (held_settlement_source_state guards the SOURCE, which is the other half).
--
-- Two columns carry the claim, so the guard reads both:
--
--   • consumed_by_inv_id — every merge into D stamps it, on the withdrawal it
--     writes for a live source and on the held settlement it consumes. It is the
--     single point every destination passes through, which is why the rule can
--     live here instead of inside the merge RPCs.
--   • merge_anchor_inv_id — the deposit a parked settlement is WAITING for.
--     Refused up front rather than at the merge: cash earmarked for a deposit
--     that may not receive it is stranded until someone notices.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_goal    uuid;
  v_pledged uuid;  -- the destination frozen as collateral
  v_free    uuid;  -- an ordinary destination, for the control
  v_src     uuid;  -- a live source to fold in
  v_held    uuid;  -- a parked settlement
  v_row     public.investment_transactions;
  v_stamp   uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'pledge-merge@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, is_pledged)
  values (v_user, v_goal, 'bank', 'investment', current_date - 200, 50000000, 6.0, current_date - 1, true)
  returning transaction_id into v_pledged;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', current_date - 200, 50000000, 6.0, current_date - 1)
  returning transaction_id into v_free;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', current_date - 200, 1000000)
  returning transaction_id into v_src;

  -- ── 1) a settlement cannot WAIT for a pledged deposit ────────────────────────
  begin
    perform public.create_held_settlement(v_src, 1000000, current_date - 1, null, v_pledged);
    raise exception 'a settlement must not be earmarked to a pledged deposit' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- The same settlement against a free anchor is ordinary.
  v_row := public.create_held_settlement(v_src, 1000000, current_date - 1, null, v_free);
  v_held := v_row.transaction_id;

  -- ── 2) a merge cannot land in a pledged deposit ──────────────────────────────
  -- Straight at the marker first: this is the write the raw API makes.
  begin
    update public.investment_transactions
       set consumed_by_inv_id = v_pledged
     where transaction_id = v_held;
    raise exception 'parked cash must not be folded into a pledged deposit' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- And through the RPC the app uses, which is what a user actually reaches.
  -- The held consume and the live-source withdrawal both stamp the destination,
  -- so either one carries the refusal.
  begin
    perform public.renew_term_deposit_with_merge(
      v_pledged, 50000000, 6.5, current_date + 180, current_date, 100000,
      null, null, null, null, '{}'::uuid[], '{}'::bigint[], null, array[v_held]
    );
    raise exception 'a merge must not complete into a pledged deposit' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- A live source folded into the pledged deposit is the same claim by the other
  -- door: the withdrawal it writes is stamped with the destination.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', current_date - 100, 2000000, 5.0, current_date + 30)
  returning transaction_id into v_src;
  begin
    perform public.renew_term_deposit_with_merge(
      v_pledged, 50000000, 6.5, current_date + 180, current_date, 100000,
      null, null, null, null, array[v_src], array[2000000::bigint], null, '{}'::uuid[]
    );
    raise exception 'a live source must not be folded into a pledged deposit' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  -- ── 3) the unpledged destination still merges ────────────────────────────────
  -- The rule is about collateral, not about merging: the control proves the guard
  -- did not simply break the flow it guards.
  v_row := public.renew_term_deposit_with_merge(
    v_free, 50000000, 6.5, current_date + 180, current_date, 100000,
    null, null, null, null, '{}'::uuid[], '{}'::bigint[], null, array[v_held]
  );
  select consumed_by_inv_id into v_stamp
    from public.investment_transactions where transaction_id = v_held;
  if v_stamp is distinct from v_free then
    raise exception 'the merge into a free deposit must still stamp, got %', v_stamp;
  end if;
  if v_row.amount_vnd <> 51000000 then
    raise exception 'the parked cash must land in the free destination, got %', v_row.amount_vnd;
  end if;

  -- ── 4) releasing the pledge releases the merge ───────────────────────────────
  -- The remedy the message names has to work, or the rule is a dead end.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', current_date - 200, 3000000)
  returning transaction_id into v_src;
  v_row := public.create_held_settlement(v_src, 3000000, current_date - 1);
  v_held := v_row.transaction_id;

  update public.investment_transactions set is_pledged = false where transaction_id = v_pledged;
  v_row := public.renew_term_deposit_with_merge(
    v_pledged, 50000000, 6.5, current_date + 180, current_date, 100000,
    null, null, null, null, '{}'::uuid[], '{}'::bigint[], null, array[v_held]
  );
  if v_row.amount_vnd <> 53000000 then
    raise exception 'the merge must go through once the pledge is released, got %', v_row.amount_vnd;
  end if;

  raise notice 'pledged_merge_destination.test.sql: OK';
end $$;

rollback;
