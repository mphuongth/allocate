-- The ledger audit has to CATCH things (#609).
--
-- #587's invariant is a trigger, so it never validated a single row written before
-- it landed. public.withdrawal_ledger_audit reads the ledger and reports what
-- would not be accepted today, one check per row of the decision table in
-- supabase/migrations/20260730000002.
--
-- The whole point of this file: an audit that returns nothing is indistinguishable
-- from an audit that looks for nothing. So every check gets a row PLANTED with the
-- triggers disabled — the only way to create shapes the invariant now refuses —
-- and the audit must name it. The other half matters just as much: a set of rows
-- built with the triggers ENABLED (so the invariant itself vouched for them) must
-- come back completely clean, or the audit's output is noise nobody will read.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_goal_b    uuid;
  v_fund      uuid;
  v_fund_ok   uuid;
  -- planted violations, one holding each so they can't flag each other
  v_neg_src   uuid; v_neg      uuid;
  v_fnu       uuid;
  v_gold_nu_s uuid; v_gold_nu  uuid;
  v_nop_src   uuid; v_nop      uuid;
  v_pnotinv   uuid;
  v_fundbuy   uuid; v_onfund   uuid;
  v_nothing   uuid;
  v_notheld   uuid;
  v_over_src  uuid;
  v_ob_goal   uuid;
  v_split     uuid;
  v_prop_src  uuid; v_prop     uuid;
  -- the clean half
  v_ok_bank   uuid; v_ok_bank_w  uuid;
  v_ok_gold   uuid; v_ok_gold_w1 uuid; v_ok_gold_w2 uuid;
  v_ok_buy    uuid; v_ok_sell1   uuid; v_ok_sell2   uuid;
  v_ok_held   uuid;
  v_seed      uuid; v_seed_buy   uuid; v_seed_sell  uuid;
  v_found     text;
  v_count     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-audit@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Car') returning goal_id into v_goal_b;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Audit Fund', 'AUDF', 'equity', 20000) returning id into v_fund;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Clean Fund', 'CLNF', 'equity', 20000) returning id into v_fund_ok;

  -- ═══ the clean half, written with the invariant WATCHING ═══════════════════
  -- Built first and with the triggers on, so each row below is legal by
  -- construction — the audit has no licence to complain about any of them.

  -- bank: principal-only, partly withdrawn
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_ok_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 41000000, v_ok_bank, 40000000)
  returning transaction_id into v_ok_bank_w;

  -- gold: quantity-valued, sold in two proportional slices down to nothing
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_ok_gold;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 12000000, v_ok_gold, 10000000, 1)
  returning transaction_id into v_ok_gold_w1;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 36000000, v_ok_gold, 30000000, 3)
  returning transaction_id into v_ok_gold_w2;

  -- fund: basis 1,050,000 (fees in) against a NAV cost of 1,000,000, sold out in
  -- two slices. The two figures differing is the normal case, not a corner one.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1050000, 100, 10000, v_fund_ok) returning transaction_id into v_ok_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-02-01', 720000, v_fund_ok, 630000, 60)
  returning transaction_id into v_ok_sell1;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-03-01', 480000, v_fund_ok, 420000, 40)
  returning transaction_id into v_ok_sell2;

  -- held-for-merge with no source: the ONE legal sourceless withdrawal (#588)
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, true, v_goal_b)
  returning transaction_id into v_ok_held;

  -- a pending DCA seed (units null) shares the bucket with a real purchase. It
  -- holds nothing sellable, so a FULL sale takes the purchase's basis only — the
  -- audit must exclude seeds from the basis exactly as the invariant does, or
  -- every DCA bucket in the ledger reports as under-taken.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, is_dca_seeded)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-04-01', 2000000, v_fund_ok, true) returning transaction_id into v_seed;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-01-01', 1000000, 50, 20000, v_fund_ok) returning transaction_id into v_seed_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'fund', 'withdrawal', '2026-05-01', 1100000, v_fund_ok, 1000000, 50)
  returning transaction_id into v_seed_sell;

  -- ═══ the planted violations ════════════════════════════════════════════════
  -- Disabling the user triggers is the only way in: these are precisely the shapes
  -- the invariant refuses, which is why they can only exist as HISTORY.
  alter table public.investment_transactions disable trigger user;

  -- 1. a negative withdrawal runs the ledger backwards
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000) returning transaction_id into v_neg_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 1000000, v_neg_src, -1000000)
  returning transaction_id into v_neg;

  -- 2. a fund sale with no units: the overview skips the subtraction entirely
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1000000, 100, 10000, v_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-02-01', 100000, v_fund, 100000)
  returning transaction_id into v_fnu;

  -- 3. a gold sale with no units: the basis drops, every chỉ stays in net worth
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_gold_nu_s;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 12000000, v_gold_nu_s, 10000000)
  returning transaction_id into v_gold_nu;

  -- 4. no principal: claims cash left while the deposit keeps its full value
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000) returning transaction_id into v_nop_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 1000000, v_nop_src, 0)
  returning transaction_id into v_nop;

  -- 5. parented to a withdrawal: a balance invented out of money already gone
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 1000000, v_ok_bank_w, 1000000)
  returning transaction_id into v_pnotinv;

  -- 6. parented to a FUND purchase: never counted by anything (#606)
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-01-01', 500000, 25, 20000, v_fund) returning transaction_id into v_fundbuy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal_b, 'bank', 'withdrawal', '2026-02-01', 100000, v_fundbuy, 100000)
  returning transaction_id into v_onfund;

  -- 7. an orphan: takes money out of no holding at all (#607)
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, 5000000)
  returning transaction_id into v_nothing;

  -- 8. sourceless and NOT held-for-merge, claiming nothing: no holding, no
  --    exception to stand under
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000)
  returning transaction_id into v_notheld;

  -- 9. a deposit withdrawn past zero: 60M + 60M out of 100M
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_over_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 60000000, v_over_src, 60000000);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 60000000, v_over_src, 60000000);

  -- 10. a fund bucket sold twice over: 60 + 60 units out of 100
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Overdrawn bucket') returning goal_id into v_ob_goal;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_ob_goal, 'fund', 'investment', '2026-01-01', 1000000, 100, 10000, v_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_ob_goal, 'fund', 'withdrawal', '2026-02-01', 700000, v_fund, 600000, 60);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_ob_goal, 'fund', 'withdrawal', '2026-03-01', 700000, v_fund, 400000, 60);

  -- 11. a sell alone in its bucket — the split an assign racing a sale leaves
  --     behind (#610). Its purchases are in another goal, so nothing here offsets.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, null, 'fund', 'withdrawal', '2026-02-01', 300000, v_fund, 300000, 30)
  returning transaction_id into v_split;

  -- 12. basis taken out of step with the units: 1 chỉ of 4 taking the whole cost
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_prop_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 12000000, v_prop_src, 40000000, 1)
  returning transaction_id into v_prop;

  alter table public.investment_transactions enable trigger user;

  -- ═══ every planted row must be named, by the right check ═══════════════════
  -- Asserting the CHECK NAME and not merely "something was reported": a row caught
  -- by the wrong check sends whoever reads the report after the wrong repair.
  for v_found, v_count in
    select x.name, (select count(*) from public.withdrawal_ledger_audit a
                     where a.check_name = x.name and a.transaction_id = x.tx)
      from (values
        ('negative_amounts',              v_neg),
        ('fund_sale_missing_units',       v_fnu),
        ('gold_sale_missing_units',       v_gold_nu),
        ('withdrawal_missing_principal',  v_nop),
        ('parent_is_not_an_investment',   v_pnotinv),
        ('parent_is_a_fund_purchase',     v_onfund),
        ('draws_on_no_holding',           v_nothing),
        ('sourceless_not_held_for_merge', v_notheld)
      ) as x(name, tx)
  loop
    if v_count <> 1 then
      raise exception 'the audit must report % exactly once for the planted row, got %', v_found, v_count;
    end if;
  end loop;

  -- the three group-level checks, keyed by holding rather than by row
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'holding_overdrawn' and parent_transaction_id = v_over_src) then
    raise exception 'the audit must report the deposit withdrawn past zero';
  end if;
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'fund_bucket_overdrawn' and goal_id = v_ob_goal and fund_id = v_fund) then
    raise exception 'the audit must report the fund bucket sold twice over';
  end if;
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'fund_bucket_has_no_purchases' and transaction_id = v_split) then
    raise exception 'the audit must report the sell left alone in its bucket';
  end if;
  -- Proportionality is a HOLDING-level fact, not a per-row one: the allocation rule
  -- is additive (each sale takes units × basis / total_units regardless of order),
  -- so what the ledger can still be measured against after the fact is the sum.
  -- Keyed by the holding for that reason.
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'basis_not_proportional' and parent_transaction_id = v_prop_src) then
    raise exception 'the audit must report the gold sale that took the whole basis for one of four units';
  end if;

  -- ═══ and nothing the invariant itself accepted ═════════════════════════════
  -- The half that decides whether the report is worth reading. A false positive
  -- here is worse than a miss: it teaches whoever runs this to ignore the output.
  select count(*) into v_count
    from public.withdrawal_ledger_audit
   where transaction_id in (v_ok_bank_w, v_ok_gold_w1, v_ok_gold_w2, v_ok_sell1, v_ok_sell2,
                            v_ok_held, v_seed, v_seed_buy, v_seed_sell)
      or parent_transaction_id in (v_ok_bank, v_ok_gold)
      or (fund_id = v_fund_ok);
  if v_count <> 0 then
    raise exception 'the audit reported % row(s) against a ledger the invariant accepted', v_count;
  end if;

  -- A withdrawal-free ledger is silent too: the checks must key off withdrawals,
  -- not flag every holding that has none.
  if exists (select 1 from public.withdrawal_ledger_audit
              where parent_transaction_id = v_seed_buy or transaction_id = v_seed_buy) then
    raise exception 'a purchase with no withdrawals must not be reported';
  end if;

  raise notice 'withdrawal_ledger_audit: every check proven to fire, clean rows silent';
end $$;

-- The audit is an operator tool: it reports one user's ledger health, and there is
-- no screen that reads it. Left granted, it would be one more PostgREST surface to
-- reason about for no gain — same reasoning as check_withdrawal_balance's REVOKE.
do $$
declare v_ok boolean;
begin
  select has_table_privilege('authenticated', 'public.withdrawal_ledger_audit', 'select') into v_ok;
  if v_ok then
    raise exception 'authenticated must not be able to select the ledger audit';
  end if;
  select has_table_privilege('anon', 'public.withdrawal_ledger_audit', 'select') into v_ok;
  if v_ok then
    raise exception 'anon must not be able to select the ledger audit';
  end if;
end $$;

rollback;
