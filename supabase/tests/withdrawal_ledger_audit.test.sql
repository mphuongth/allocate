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
  v_sliver_src uuid; v_sliver_a uuid; v_sliver_b uuid;
  v_tail2_src uuid; v_tail2_a uuid; v_tail2_b uuid;
  v_basisover_src uuid;
  v_zerounit_goal uuid;
  -- the clean half
  v_tol_goal  uuid;
  v_drift_src uuid; v_comp_src uuid; v_f7_src uuid; v_full_src uuid; v_tail_src uuid;
  v_roundup_src uuid;
  v_tiny_fund uuid; v_late_fund uuid; v_late_sell uuid;
  v_orphan_fund uuid; v_orphan_buy uuid; v_orphan_goal uuid;
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

  -- The same 4-decimal rounding that posts 3.9999 for a full sale posts 4.0001 for
  -- one just as often, and the invariant accepts both — the units cap allows the
  -- epsilon, and the sale is a full one either way, so it takes the whole basis.
  -- Measured against the flat rate that row is a thousand đồng UNDER, where the
  -- 3.9999 one is a thousand over. A slack that only forgives the under-rounded
  -- direction reports half the full gold sales in the ledger.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal_b, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_roundup_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'gold', 'withdrawal', '2026-02-01', 48000000, v_roundup_src, 40000000, 4.0001);

  -- A zero-principal sale that was right when it was written, judged later against
  -- a bucket that grew. 1 đồng over 100 units makes a 1-unit slice worth nothing, so
  -- zero is the correct principal and the invariant accepts it; a 999 đồng purchase
  -- arriving afterwards moves the bucket's ratio and the same row now looks 5 đồng
  -- short. Every write was legal, so the audit may not call it a VIOLATION — the
  -- proportionality check may still raise it for review, which is what that severity
  -- is for and why its own comment names purchases added after a sale.
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Late Fund', 'LATE', 'equity', 1) returning id into v_late_fund;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-01-01', 1, 100, 1, v_late_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'fund', 'withdrawal', '2026-02-01', 1, v_late_fund, 0, 1)
  returning transaction_id into v_late_sell;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-03-01', 999, 100, 10, v_late_fund);

  -- An orphan bucket the invariant itself allows. A 0.0001-unit sell worth a đồng
  -- is left behind when its purchase moves to another goal: check_fund_bucket_solvent
  -- (#587) refuses a relocation only when the bucket would be left owing MORE than
  -- 0.0001 units or one đồng, so this state is reachable with every trigger enabled.
  -- A purchase-less bucket is therefore not corrupt by itself, and calling it one
  -- would hand an operator a repair to make on a ledger nobody wrote wrong.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Orphan target') returning goal_id into v_orphan_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Orphan Fund', 'ORPH', 'equity', 1) returning id into v_orphan_fund;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_goal_b, 'fund', 'investment', '2026-01-01', 1000000, 100, 10000, v_orphan_fund) returning transaction_id into v_orphan_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal_b, 'fund', 'withdrawal', '2026-02-01', 1, v_orphan_fund, 1, 0.0001);
  update public.investment_transactions set goal_id = v_orphan_goal where transaction_id = v_orphan_buy;

  -- ═══ the planted violations ════════════════════════════════════════════════
  -- Disabling the user triggers is the only way in: these are precisely the shapes
  -- the invariant refuses, which is why they can only exist as HISTORY.
  alter table public.investment_transactions disable trigger user;

  -- A held-for-merge row with no source. #588 requires one, through a DEFERRED
  -- constraint trigger — so this row belongs here, with the user triggers off,
  -- for the same reason as every other planted shape: it can only exist as
  -- HISTORY. (Its target goal matches goal_id because the shape CHECK is
  -- immediate; only the missing source is what makes it legacy.) The invariant's
  -- held exemption is unchanged, so the view must still read it as clean.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, held_for_merge, merge_target_goal_id)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 5000000, true, v_goal)
  returning transaction_id into v_ok_held;

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

  -- 23. two slivers that are the ONLY sales on the holding, taking 1 and 199 đồng
  --     where each owes about 100. Their total is exactly proportional, so the
  --     holding-level check is silent, and both are sub-epsilon so the sliver
  --     exception hid them as well. But the exception is for the TAIL of an
  --     exhausted holding — a sliver can only take a whole remaining basis if it
  --     closed the holding, and 0.0002 of 1 unit closes nothing. Here 0.9998 units
  --     are still unsold, so no ordering makes either row legal.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000000, 1, 1000000) returning transaction_id into v_sliver_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_sliver_src, 1, 0.0001)
  returning transaction_id into v_sliver_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_sliver_src, 199, 0.0001)
  returning transaction_id into v_sliver_b;

  -- 24. an exhausted tail whose slivers are BOTH wrong: 0.9998 units takes its
  --     999,800, then two 0.0001 slivers take 50 and 150 of the 200 left. Units and
  --     principal both add up exactly, so the holding-level checks are silent, and
  --     the tail exemption skipped the slivers. But only one sliver can be the
  --     closer that empties the basis; the other must take its flat share or, if it
  --     came after, nothing. Neither of these does — all six orderings were run
  --     against the invariant and every one is refused.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000000, 1, 1000000) returning transaction_id into v_tail2_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_tail2_src, 999800, 0.9998);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_tail2_src, 50, 0.0001)
  returning transaction_id into v_tail2_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-04-01', 1, v_tail2_src, 150, 0.0001)
  returning transaction_id into v_tail2_b;

  -- 25. basis taken far past what the holding cost: 40,000,000 over 4 units, two
  --     sales of 2 units taking 30,000,000 each. The units add up, so nothing is
  --     over-sold — but 60,000,000 of cost has left a 40,000,000 holding, and
  --     dashboard/overview subtracts exactly that sum from invested capital. Not a
  --     violation: the invariant places no cap on the principal of a
  --     quantity-valued holding, so the audit can only raise it for review.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000) returning transaction_id into v_basisover_src;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_basisover_src, 30000000, 2),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_basisover_src, 30000000, 2);

  -- 26. a bucket whose purchase holds ZERO units, sold from anyway. The schema
  --     permits zero units; the invariant does not permit selling them — it grants
  --     the 4-decimal epsilon only while something is left, so 0.0001 units out of
  --     nothing is refused. Granting that epsilon unconditionally made this ledger
  --     audit clean.
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Zero units') returning goal_id into v_zerounit_goal;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id)
  values (v_user, v_zerounit_goal, 'fund', 'investment', '2026-01-01', 1000, 0, 0, v_fund);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_zerounit_goal, 'fund', 'withdrawal', '2026-02-01', 1, v_fund, 0, 0.0001);

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
        ('sale_basis_not_proportional',   v_mask_zero),
        ('sale_basis_not_proportional',   v_cancel_a),
        ('sale_basis_not_proportional',   v_cancel_b),
        ('sale_basis_not_proportional',   v_slack),
        ('sale_basis_not_proportional',   v_pair_a),
        ('sale_basis_not_proportional',   v_pair_b),
        ('sale_basis_not_proportional',   v_sg_a),
        ('sale_basis_not_proportional',   v_sg_b),
        ('sale_basis_not_proportional',   v_closer),
        ('sale_basis_not_proportional',   v_sliver_a),
        ('sale_basis_not_proportional',   v_sliver_b),
        ('sale_basis_not_proportional',   v_tail2_a),
        ('sale_basis_not_proportional',   v_tail2_b)
      ) as x(name, tx)
  loop
    if v_count <> 1 then
      raise exception 'the audit must report % exactly once for the planted row, got %', v_found, v_count;
    end if;
  end loop;

  -- The detail an operator reads is part of the report, not decoration: this row's
  -- principal IS offset now (lib/withdrawalProgress values it against the parent
  -- purchase's fund bucket, #606), and the old wording — "which no valuation
  -- offsets" — would send whoever reads it to subtract the same money a second time.
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where transaction_id = v_onfund
                    and detail like '%valued against that fund bucket%') then
    raise exception 'the fund-parented withdrawal must be reported as valued, not as uncounted';
  end if;

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
                  where check_name = 'fund_bucket_overdrawn' and goal_id = v_zerounit_goal) then
    raise exception 'the audit must report units sold out of a bucket that holds none';
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

  if not exists (select 1 from public.withdrawal_ledger_audit
                  where check_name = 'basis_taken_exceeds_cost' and severity = 'review'
                    and parent_transaction_id = v_basisover_src) then
    raise exception 'the audit must raise basis taken past the holding cost for review';
  end if;
  if exists (select 1 from public.withdrawal_ledger_audit
              where check_name = 'basis_taken_exceeds_cost' and severity = 'violation') then
    raise exception 'a basis overrun on a quantity-valued holding is not provable and may not be a violation';
  end if;

  -- Nothing whose every write was legal may be called a violation. 'review' is
  -- allowed here: the ratio really did move, and saying so is this check's job.
  if exists (select 1 from public.withdrawal_ledger_audit
              where transaction_id = v_late_sell and severity = 'violation') then
    raise exception 'a sale that was correct when written must not become a violation because the bucket grew';
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
      or parent_transaction_id in (v_ok_bank, v_ok_gold, v_drift_src, v_comp_src, v_f7_src, v_full_src, v_tail_src, v_roundup_src)
      or fund_id in (v_fund_ok, v_tiny_fund, v_orphan_fund);
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

-- ═══ one bucket, one balance across both sale shapes (#606) ════════════════
-- A fund-keyed sell and a sell parented to a purchase in the same bucket used to be
-- measured against two different balances, and the audit aggregated only the first
-- — so 55 units out of a 50-unit bucket reported clean while the reader subtracted
-- all 55 and dropped the holding five units early. The write path refuses the
-- parented shape now; what is already in the ledger has to be REPORTED, which is
-- why these rows are planted with the trigger off.
do $$
declare
  v_user uuid; v_goal uuid; v_fund uuid; v_buy uuid; v_par uuid; v_par_bare uuid; v_n int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-audit-606@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Mixed shapes') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Mixed Fund', 'MIXF', 'equity', 25000) returning id into v_fund;

  alter table public.investment_transactions disable trigger user;

  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 50, 40000)
  returning transaction_id into v_buy;

  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-02-01', 1125000, 45, 1800000);

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, null, 'withdrawal', '2026-03-01', 250000, v_buy, 10, 400000)
  returning transaction_id into v_par;

  alter table public.investment_transactions enable trigger user;

  -- 55 of 50 units, whichever shape took them.
  select count(*) into v_n from public.withdrawal_ledger_audit
   where user_id = v_user and check_name = 'fund_bucket_overdrawn' and fund_id = v_fund;
  if v_n <> 1 then
    raise exception 'the audit must report the bucket drawn on by both sale shapes, got %', v_n;
  end if;

  -- And the parented row is not ALSO charged to the purchase it names: one claim,
  -- one balance. Counting it twice would invent an overdrawn holding on top.
  select count(*) into v_n from public.withdrawal_ledger_audit
   where user_id = v_user and check_name = 'holding_overdrawn';
  if v_n <> 0 then
    raise exception 'a fund-parented sale must not be charged to the purchase as well, got % holding overdraw(s)', v_n;
  end if;

  -- It stays named for review, with the detail that says it IS valued.
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where transaction_id = v_par and check_name = 'parent_is_a_fund_purchase'
                    and detail like '%valued against that fund bucket%') then
    raise exception 'the fund-parented row must still be reported for review';
  end if;

  -- The same claim wearing a RETAINED fund_id and no asset_type — what editing a
  -- sell's asset_type off 'fund' leaves behind (the PUT clears fund_id only when
  -- that field is sent). The reader reads it as not fund-keyed and charges the
  -- parent's bucket, so the audit has to as well: written without coalescing the
  -- inner test, `not (asset_type = 'fund' and ...)` is NULL for this row and it
  -- fell out of both branches.
  alter table public.investment_transactions disable trigger user;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, v_fund, null, 'withdrawal', '2026-03-02', 250000, v_buy, 10, 400000)
  returning transaction_id into v_par_bare;
  alter table public.investment_transactions enable trigger user;

  if not exists (select 1 from public.withdrawal_ledger_audit
                  where transaction_id = v_par_bare and check_name = 'parent_is_a_fund_purchase'
                    and detail like '%valued against that fund bucket%') then
    raise exception 'a claim with a retained fund_id and no asset_type must be read as the reader reads it';
  end if;

  raise notice 'withdrawal_ledger_audit: both sale shapes share one bucket balance';
end $$;

-- A legacy row that records only PRINCIPAL still takes units out of the bucket:
-- the reader derives them pro-rata from the purchase it names. An audit that
-- scored such a row as zero units called a bucket sold past its units clean —
-- 102 units out of 101, silent, which is the one thing this check is for.
do $$
declare
  v_user uuid; v_goal uuid; v_fund uuid; v_big uuid; v_n int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-audit-derived@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Derived units') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Derived Fund', 'DRVF', 'equity', 10) returning id into v_fund;

  alter table public.investment_transactions disable trigger user;

  -- Two purchases at very different prices, so the bucket's average hides what the
  -- named purchase actually gives up: 100 units for 1000 đồng, and 1 for 1000.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 1000, 100, 10)
  returning transaction_id into v_big;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-02', 1000, 1, 1000);

  -- Principal-only draw on the 100-unit purchase: the reader takes all 100 units.
  -- Written as a recorded ZERO rather than a null, because that is the harder shape:
  -- the old write path demanded positive units only from a gold parent, and a
  -- coalesce would let the zero slip past the derivation on both sides.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, null, 'withdrawal', '2026-02-01', 1000, v_big, 0, 1000);
  -- Plus an ordinary 2-unit sell: 102 units asked of a bucket holding 101.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units_withdrawn, principal_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-03-01', 20, 2, 20);

  alter table public.investment_transactions enable trigger user;

  select count(*) into v_n from public.withdrawal_ledger_audit
   where user_id = v_user and check_name = 'fund_bucket_overdrawn' and fund_id = v_fund;
  if v_n <> 1 then
    raise exception 'the audit must count the units a principal-only row derives, got % overdraw(s)', v_n;
  end if;

  -- And the detail must not call it "units 0": the dashboard removed the derived
  -- quantity, and an operator reading zero would conclude nothing was taken.
  if not exists (select 1 from public.withdrawal_ledger_audit
                  where user_id = v_user and check_name = 'parent_is_a_fund_purchase'
                    and detail like '%derived pro-rata%') then
    raise exception 'a recorded zero must be reported as derived, not as units 0';
  end if;

  raise notice 'withdrawal_ledger_audit: derived units count against the bucket';
end $$;

-- A fund-typed parent with no fund of its own is NOT a bucket: the reader leaves
-- such a row on the parent axis, where nothing reads it. Telling an operator it was
-- "valued against that fund bucket" would have them leave an unvalued row alone.
do $$
declare
  v_user uuid; v_goal uuid; v_orphan uuid; v_wd uuid; v_detail text;
  v_nofund_fund uuid; v_zero uuid; v_zero_wd uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-audit-nofund@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'No fund') returning goal_id into v_goal;

  alter table public.investment_transactions disable trigger user;

  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Zero Unit Fund', 'ZUF', 'equity', 25000) returning id into v_nofund_fund;

  -- A fund purchase whose fund is gone (the FK is ON DELETE SET NULL).
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1000000, 50, 20000)
  returning transaction_id into v_orphan;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, null, 'withdrawal', '2026-02-01', 400000, v_orphan, 400000)
  returning transaction_id into v_wd;

  alter table public.investment_transactions enable trigger user;

  select detail into v_detail from public.withdrawal_ledger_audit
   where transaction_id = v_wd and check_name = 'parent_is_a_fund_purchase';
  if v_detail is null then
    raise exception 'the row must still be reported';
  end if;
  if v_detail like '%valued against that fund bucket%' then
    raise exception 'a parent with no fund is no bucket: the audit must not claim the row was valued';
  end if;
  if v_detail not like '%carries no fund of its own%' then
    raise exception 'the detail must say why nothing values it, got: %', v_detail;
  end if;

  -- A ZERO-unit fund purchase is a different case and must not wear the same
  -- sentence: it IS valued — as an ordinary holding, with its withdrawal applied on
  -- the parent axis — so telling an operator nothing values it invites a repair
  -- that subtracts the money twice.
  alter table public.investment_transactions disable trigger user;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_nofund_fund, 'fund', 'investment', '2026-01-01', 1000000, 0, 0)
  returning transaction_id into v_zero;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, null, 'withdrawal', '2026-02-01', 400000, v_zero, 400000)
  returning transaction_id into v_zero_wd;
  alter table public.investment_transactions enable trigger user;

  select detail into v_detail from public.withdrawal_ledger_audit
   where transaction_id = v_zero_wd and check_name = 'parent_is_a_fund_purchase';
  if v_detail like '%no bucket values it%' or v_detail like '%valued against that fund bucket%' then
    raise exception 'a zero-unit purchase is valued on the parent axis; the audit said: %', v_detail;
  end if;
  if v_detail not like '%holds no units%' then
    raise exception 'the detail must say the purchase holds no units, got: %', v_detail;
  end if;

  raise notice 'withdrawal_ledger_audit: no bucket, no claim that the row was valued';
end $$;

-- ═══ the contract itself ═══════════════════════════════════════════════════
-- Two claims the view's header makes, kept honest here rather than in prose alone.
do $$
declare
  v_user uuid; v_g uuid; v_s uuid; v_tiny uuid; v_violations int; v_any int; i int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-audit-contract@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'G') returning goal_id into v_g;

  -- CLAIM 1: an empty result does not prove the ledger clean.
  --
  -- 1000 đồng over 100 units, two sales of 50 units taking 497 and 503. Refused as
  -- a first write (50 of 100 must take 500) and neither can follow the other — all
  -- orderings are illegal — yet the totals are exactly proportional and each
  -- per-sale deviation is inside what a legal two-sale ledger shows elsewhere. The
  -- audit CANNOT see it, and this test exists so that silence is never mistaken for
  -- a guarantee: if someone later makes this ledger report, the header's claim has
  -- changed and both must be revisited together.
  alter table public.investment_transactions disable trigger user;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_g, 'gold', 'investment', '2026-01-01', 1000, 100, 10) returning transaction_id into v_s;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_g, 'gold', 'withdrawal', '2026-02-01', 1, v_s, 497, 50),
         (v_user, v_g, 'gold', 'withdrawal', '2026-03-01', 1, v_s, 503, 50);

  alter table public.investment_transactions enable trigger user;

  select count(*) into v_any from public.withdrawal_ledger_audit where user_id = v_user;
  if v_any <> 0 then
    raise notice 'the known-blind ledger now reports % row(s) — the header limit may be stale', v_any;
  end if;

  -- CLAIM 1b: a legal ledger may never produce a VIOLATION, however odd it looks.
  --
  -- A 1 đồng / 5 unit gold holding sold in three 1-unit slices. Each slice's
  -- proportional share rounds to zero, and the invariant still demands a positive
  -- principal from a parent-backed withdrawal, so each records the single đồng it is
  -- allowed — three đồng out of a one đồng holding, every write accepted. There is
  -- no principal cap in the quantity-valued branch at all: it enforces the
  -- proportional allocation, not a running total. 'Σ principal ≤ basis' was never
  -- the invariant's rule for gold or funds, so it cannot be a violation.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_g, 'gold', 'investment', '2026-01-01', 1, 5, 1) returning transaction_id into v_tiny;
  for i in 1..3 loop
    insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
    values (v_user, v_g, 'gold', 'withdrawal', '2026-02-01', 1, v_tiny, 1, 1);
  end loop;

  select count(*) into v_violations
    from public.withdrawal_ledger_audit
   where severity = 'violation' and (parent_transaction_id = v_tiny or transaction_id in
         (select transaction_id from public.investment_transactions where parent_transaction_id = v_tiny));
  if v_violations <> 0 then
    raise exception 'a ledger the invariant accepted was reported as a violation (% row(s))', v_violations;
  end if;

  -- CLAIM 2: 'violation' means provable from state. The sequence-sensitive checks
  -- may never wear it, whatever they find — a repair automated off one of those
  -- would be acting on a ledger that might have been written legally.
  select count(*) into v_violations
    from public.withdrawal_ledger_audit
   where severity = 'violation'
     and check_name in ('sale_basis_not_proportional', 'basis_not_proportional', 'parent_is_a_fund_purchase');
  if v_violations <> 0 then
    raise exception 'a sequence-sensitive check reported % row(s) as a violation', v_violations;
  end if;

  raise notice 'withdrawal_ledger_audit: contract holds — sequence-sensitive findings stay advisory';
end $$;

rollback;
