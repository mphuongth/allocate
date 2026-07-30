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
  v_stray     uuid; v_stray_z  uuid;
  v_mask_goal uuid; v_mask_zero uuid;
  v_eps_src   uuid; v_nounits_src uuid;
  v_cancel_src uuid; v_cancel_a uuid; v_cancel_b uuid;
  v_slack_src uuid; v_slack uuid;
  v_pair_src uuid; v_pair_a uuid; v_pair_b uuid;
  v_split_goal_src uuid; v_sg_a uuid; v_sg_b uuid;
  v_closer_src uuid; v_closer uuid;
  -- the clean half
  v_tol_goal  uuid;
  v_drift_src uuid; v_comp_src uuid; v_f7_src uuid; v_full_src uuid; v_tail_src uuid;
  v_tiny_fund uuid;
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

  -- The invariant's allocation rule tolerates one đồng per sale, because that is
  -- what rounding a proportional slice produces. A full sale taking basis + 1 is
  -- therefore ACCEPTED — the insert below proves it, since the triggers are still
  -- on — and an audit stricter than the invariant it audits would report a ledger
  -- nobody can fix.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Rounding') returning goal_id into v_tol_goal;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_tol_goal, 'fund', 'investment', '2026-01-01', 1000000, 100, 10000, v_fund_ok);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_tol_goal, 'fund', 'withdrawal', '2026-02-01', 1200000, v_fund_ok, 1000001, 100);

  -- The đồng of rounding, unlike the overdraw bound, DOES accumulate across sales:
  -- each partial sale's expectation is recomputed from what is left, so two sales
  -- may each under-take by a đồng and the invariant accepts both. 100 đồng over 4
  -- units, two sales of 1 unit taking 24 where the flat proportion says 25 — the
  -- aggregate is 48 against 50, and the audit must not call that a finding.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 100, 4, 25) returning transaction_id into v_drift_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 1, v_drift_src, 24, 1);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_drift_src, 24, 1);

  -- Worse than additive, because each expectation is recomputed from the ROUNDED
  -- remaining: 100 đồng over 15 units, a sale of 7 units taking 48 where the
  -- expectation is 47, then 1 unit of the remaining 8 taking 8 where the
  -- expectation is round(52/8) = 7. Both inside the allowance, so both accepted —
  -- but the aggregate is 56 against a flat expectation of 53, a drift of 3 across
  -- 2 sales. A simulation over invariant-legal sequences puts the worst case at
  -- 1.5 đồng per sale (the drift CONTRACTS by 1 − units/remaining each step, so it
  -- cannot run away), which is what the tolerance is set from.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 100, 15, 7) returning transaction_id into v_comp_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 1, v_comp_src, 48, 7);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_comp_src, 8, 1);

  -- An epsilon-sized sale is legal or not depending ONLY on the order it was
  -- written in, and the audit reads state, not history. Taking 0.00005 units FIRST
  -- and the whole unit second is accepted by the invariant (the epsilon is granted
  -- while something is left); exhausting the unit first and then taking 0.00005 is
  -- refused. Both leave the same totals behind, so no state-based check can tell
  -- them apart — which means the audit must stay SILENT here rather than report a
  -- ledger that was written legally. Pinned so a later "tighten the epsilon" cannot
  -- turn this into a false positive; the exposure it leaves is bounded by one
  -- epsilon of units, and is recorded as a known limit in the view's header.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 100, 1, 100) returning transaction_id into v_f7_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 1, v_f7_src, 1, 0.00005);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_f7_src, 99, 1);

  -- The clients round units to 4 decimals, so "sell everything" routinely posts a
  -- hair UNDER the holding — 4 chỉ leaves as 3.9999 — and the invariant treats a
  -- sale within an epsilon of the rest as a FULL one, taking the whole basis. A
  -- per-sale check against the flat rate units × basis / total_units therefore sees
  -- a legitimate gap of 0.0001 × basis / units, which on an ordinary 40,000,000
  -- gold holding is a thousand đồng. Nothing exotic: this is what a full gold sale
  -- looks like in this app.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_full_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 48000000, v_full_src, 40000000, 3.9999);

  -- A slice so small its proportional basis rounds to nothing: 100 units of a
  -- 1,000,000-unit bucket worth 1000 đồng. round(1000 × 100 / 1000000) = 0, and the
  -- invariant accepts a zero principal because it is within a đồng of that
  -- expectation — lib/fundWithdrawal returns 0 here too. So "a fund sell with no
  -- principal" is not universally invalid, and the audit may only call it that when
  -- the expected slice is actually worth something.
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Tiny Fund', 'TINY', 'equity', 1) returning id into v_tiny_fund;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-01-01', 1000, 1000000, 1, v_tiny_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'fund', 'withdrawal', '2026-02-01', 1, v_tiny_fund, 0, 100);

  -- The tail of an epsilon-exhausted holding, built one accepted insert at a time.
  -- 1,000,000 đồng over 1 unit: 0.9998 units takes its 999,800, then 0.0001 units
  -- is within an epsilon of the 0.0002 remaining and so is a FULL sale taking all
  -- 200 left, then a last 0.0001 takes the 1 đồng the invariant insists a
  -- parent-backed withdrawal must record. Measured against the flat rate those two
  -- slivers are 100 and 99 đồng out — TWO rows past the base tolerance on one
  -- holding, which is exactly the pattern that says "no legal sequence explains
  -- this". Here a legal sequence does explain it, so slivers are left out of that
  -- count; which of them were legal depends on write order, the same
  -- undecidable-from-state limit as the header records.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 1000000, 1, 1000000) returning transaction_id into v_tail_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 1, v_tail_src, 999800, 0.9998);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_tail_src, 200, 0.0001);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-04-01', 1, v_tail_src, 1, 0.0001);

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

  -- 13. a fund sell whose asset_type was edited off 'fund': it KEEPS its fund_id,
  --     but a retained id is not a bucket key without asset_type='fund', so the
  --     row draws on nothing (the invariant refuses exactly this shape). Keying the
  --     audit off `fund_id is null` would make this reachable corruption invisible.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, v_fund, 5000000)
  returning transaction_id into v_stray;

  -- 14. the same stranded shape carrying no deltas: still not a held-for-merge row
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, v_fund)
  returning transaction_id into v_stray_z;

  -- 15. two sells whose basis errors CANCEL: one takes nothing, the other takes
  --     double. The invariant refuses each on its own, but the bucket's totals come
  --     out exactly proportional — so a holding-level check alone reports a clean
  --     bucket and both invalid rows stay silent. This is why the missing-principal
  --     check has to be per row.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Masked') returning goal_id into v_mask_goal;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_mask_goal, 'fund', 'investment', '2026-01-01', 1000000, 100, 10000, v_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_mask_goal, 'fund', 'withdrawal', '2026-02-01', 600000, v_fund, 0, 50)
  returning transaction_id into v_mask_zero;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_mask_goal, 'fund', 'withdrawal', '2026-03-01', 600000, v_fund, 1000000, 50);

  -- 16. two sales past the units by MORE than one epsilon between them. The unit
  --     tolerance does not accumulate: every constraint the invariant applies bounds
  --     the CUMULATIVE sum (each sale is measured against what is left, which
  --     already carries the previous sale's excess), so 4.00015 out of 4 units is a
  --     ledger it would never have produced — the second insert is refused, proven
  --     by probe. Principals are kept proportional so nothing else speaks up.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_eps_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_eps_src, 20000500, 2.00005);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_eps_src, 19999500, 2.0001);

  -- 17. units taken out of a holding that HAS no units. The invariant coalesces the
  --     parent's units to zero and refuses any positive quantity; skipping the check
  --     when the parent's units are null lets the row through instead.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000) returning transaction_id into v_nounits_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, v_nounits_src, 5000000, 5);

  -- 18. two sales whose allocation errors CANCEL while both principals are
  --     positive: 50 units taking 400 and 50 taking 600 out of a 1000 đồng / 100
  --     unit holding. The invariant refuses each one as a first write — 50 of 100
  --     units must take 500 — so this state is unreachable in ANY order, unlike the
  --     epsilon case above. The totals are exactly proportional, so the
  --     holding-level check cannot see it: only a per-sale comparison can.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 1000, 100, 10) returning transaction_id into v_cancel_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 1, v_cancel_src, 400, 50)
  returning transaction_id into v_cancel_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_cancel_src, 600, 50)
  returning transaction_id into v_cancel_b;

  -- 19. an ORDINARY partial sale taking the wrong basis: 1 chỉ of 4, taking
  --     10,000,500 where the rule says 10,000,000. The invariant refuses it. The
  --     full-sale slack must not cover this row — that slack exists because a sale
  --     within an epsilon of the REST takes the whole basis, and a sale of 1 of 4
  --     units is nowhere near the rest. The tell is state-visible: using the
  --     shortcut leaves at most an epsilon of units behind, so it can only have
  --     happened on a holding that ends up exhausted. This one has 3 units left.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_slack_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 12000000, v_slack_src, 10000500, 1)
  returning transaction_id into v_slack;

  -- 20. two sales that exhaust the holding and total the right basis, but neither
  --     allocation is legal in any order: 1 unit taking 10,000,500 (rule: 10,000,000)
  --     and 3 units taking 29,999,500 (rule: 30,000,000). Only ONE sale per holding
  --     can be the one that closes it, so granting the full-sale slack to every
  --     sibling of an exhausted holding hides both.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_pair_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_pair_src, 10000500, 1)
  returning transaction_id into v_pair_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_pair_src, 29999500, 3)
  returning transaction_id into v_pair_b;

  -- 21. the same unexplainable pair, but with the two sales filed under DIFFERENT
  --     goals. A withdrawal carries its own goal_id and the invariant ignores it
  --     entirely for a parent-backed row — the balance is keyed by
  --     parent_transaction_id alone — so these are siblings on one holding however
  --     they are filed. Counting them apart would let each look like the only
  --     claimant of the full-sale slack.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_split_goal_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_split_goal_src, 10000500, 1)
  returning transaction_id into v_sg_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-03-01', 1, v_split_goal_src, 29999500, 3)
  returning transaction_id into v_sg_b;

  -- 22. one wrong sale beside a correct one, on a holding sold out EXACTLY: 1 unit
  --     taking 9,999,500 (rule: 10,000,000) and 3 units taking their exact
  --     30,000,000. Only the first row is past the base tolerance, so the rationing
  --     hands it the full-sale slack — but that slack exists only for a closer that
  --     took slightly FEWER units than remained, and here nothing was left over:
  --     4 units bought, 4 sold. The row is refused as a first write and refused as
  --     the closer (probed both ways), so no slack is owed to it.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_closer_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_closer_src, 9999500, 1)
  returning transaction_id into v_closer;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_closer_src, 30000000, 3);

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
        ('sourceless_not_held_for_merge', v_notheld),
        ('draws_on_no_holding',           v_stray),
        ('sourceless_not_held_for_merge', v_stray_z),
        ('withdrawal_missing_principal',  v_mask_zero),
        ('sale_basis_not_proportional',   v_cancel_a),
        ('sale_basis_not_proportional',   v_cancel_b),
        ('sale_basis_not_proportional',   v_slack),
        ('sale_basis_not_proportional',   v_pair_a),
        ('sale_basis_not_proportional',   v_pair_b),
        ('sale_basis_not_proportional',   v_sg_a),
        ('sale_basis_not_proportional',   v_sg_b),
        ('sale_basis_not_proportional',   v_closer)
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

  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'holding_overdrawn' and parent_transaction_id = v_eps_src) then
    raise exception 'the audit must report units sold past the holding by more than one epsilon';
  end if;
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'holding_overdrawn' and parent_transaction_id = v_nounits_src) then
    raise exception 'the audit must report units taken out of a holding that has none';
  end if;

  -- Same lesson as the masked bucket, one level down: these two sales add up to
  -- exactly the right basis, so the holding-level check is silent by design.
  if exists (select 1 from public.withdrawal_ledger_audit
              where check_name = 'basis_not_proportional' and parent_transaction_id = v_cancel_src) then
    raise exception 'the cancelling pair adds up: the holding-level check is not what catches it';
  end if;

  -- The masked bucket is the point of that per-row check: its TOTALS are exactly
  -- proportional, so the holding-level check is silent by design. Asserting the
  -- silence keeps the two checks from being justified by each other.
  if exists (select 1 from public.withdrawal_ledger_audit
              where check_name = 'basis_not_proportional' and goal_id = v_mask_goal) then
    raise exception 'the masked bucket adds up: the holding-level check is not what catches it';
  end if;

  -- ═══ and nothing the invariant itself accepted ═════════════════════════════
  -- The half that decides whether the report is worth reading. A false positive
  -- here is worse than a miss: it teaches whoever runs this to ignore the output.
  select count(*) into v_count
    from public.withdrawal_ledger_audit
   where transaction_id in (v_ok_bank_w, v_ok_gold_w1, v_ok_gold_w2, v_ok_sell1, v_ok_sell2,
                            v_ok_held, v_seed, v_seed_buy, v_seed_sell)
      or parent_transaction_id in (v_ok_bank, v_ok_gold, v_drift_src, v_comp_src, v_f7_src, v_full_src, v_tail_src)
      or fund_id in (v_fund_ok, v_tiny_fund);
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
