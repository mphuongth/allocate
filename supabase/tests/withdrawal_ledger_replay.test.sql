-- The replay audit has to decide what the screening audit cannot (#613).
--
-- public.withdrawal_ledger_audit (#609 / #611) reads the ledger as it STANDS. The
-- invariant it audits is stateful, so whole families of illegal ledgers reach a
-- final state that a legal one could also have reached, and that view is silent on
-- every one of them — deliberately, and its own header says so.
--
-- public.withdrawal_ledger_replay orders each balance key's rows by created_at and
-- re-runs the invariant's transition rules over them. This file's job is to prove
-- the two halves of that claim:
--
--   • it CATCHES the sequences the screening audit provably cannot. Each such
--     fixture asserts BOTH — the replay names it, and withdrawal_ledger_audit does
--     not — so the test fails if the replay ever silently becomes a restatement of
--     the view it exists to go beyond.
--   • it stays SILENT on ledgers the invariant itself vouched for. Those are
--     planted with the triggers ON, so the invariant accepted every write, and the
--     replay has no licence to complain about any of them.
--   • and it only says 'violation' when it has the proof. created_at is the order
--     it REPORTS against; what it proves against is the ordering search, which
--     assumes no order at all. So the fixtures come in matched pairs that differ
--     only in whether a legal reading exists — same shape, different verdict — and
--     several of them are here to state what the search COSTS rather than what it
--     catches. Getting that boundary wrong in the forgiving direction makes a
--     tool nobody needs; getting it wrong the other way sends an operator to
--     repair a ledger nobody wrote wrong.
--
-- Every fixture sets created_at and updated_at by hand, and has to: now() is fixed
-- for the whole transaction, so rows inserted here would otherwise all share one
-- timestamp and there would be no order to replay. Setting created_at without
-- updated_at would also make every row look EDITED (updated_at defaults to now(),
-- which is later than a backdated created_at) and drop every finding to 'review'.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user       uuid;
  v_goal       uuid;
  v_fund       uuid;
  v_fund_ok    uuid;
  v_fund_late  uuid;
  -- the clean half
  v_ok_bank    uuid;
  v_ok_gold    uuid;
  v_ok_buy     uuid;
  v_tiny_gold  uuid;
  -- planted sequences
  v_cancel     uuid; v_cancel_a uuid; v_cancel_b uuid;
  v_early      uuid;
  v_edited     uuid; v_edited_a uuid;
  v_bank_over  uuid; v_bank_w2  uuid;
  v_legacy_buy uuid; v_legacy   uuid; v_legacy_sell uuid;
  v_tie        uuid; v_tie_a    uuid; v_tie_b       uuid;
  v_inst       uuid; v_inst_a   uuid; v_inst_b      uuid;
  v_big        uuid;
  v_fund_dep   uuid; v_dep_buy  uuid; v_dep_sell    uuid;
  v_shape      uuid; v_shape_w  uuid;
  v_other      uuid; v_other_g  uuid; v_foreign uuid; v_foreign_w uuid;
  i            int;
  v_found      text;
  v_count      int;
  v_audit      int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-replay@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Replay Fund', 'RPLF', 'equity', 20000) returning id into v_fund;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Clean Fund', 'RCLN', 'equity', 20000) returning id into v_fund_ok;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Late Fund', 'RLAT', 'equity', 20000) returning id into v_fund_late;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Dep Fund', 'RDEP', 'equity', 20000) returning id into v_fund_dep;

  -- ═══ the clean half, written with the invariant WATCHING ═══════════════════
  -- Each write below passed check_withdrawal_balance against the balance the
  -- earlier writes left, which is the very sequence the replay reconstructs. A
  -- finding on any of them is a false positive by construction.

  -- bank: principal-only, drawn down to nothing in two withdrawals
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_ok_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 40000000, v_ok_bank, 40000000,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 60000000, v_ok_bank, 60000000,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');

  -- gold: quantity-valued, a partial slice and then the closer
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_ok_gold;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 11000000, v_ok_gold, 10000000, 1,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 31000000, v_ok_gold, 30000000, 3,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');

  -- a gold holding so small every slice's proportional share rounds to nothing —
  -- three đồng legally leave a one đồng holding, every write accepted (the
  -- invariant separately demands a positive principal). The replay must reach the
  -- same verdict the invariant did, one sale at a time.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1, 5, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_tiny_gold;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_tiny_gold, 1, 1, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_tiny_gold, 1, 1, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-04-01', 1, v_tiny_gold, 1, 1, '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');

  -- a fund bucket with a purchase arriving BETWEEN two sells: the second sell's
  -- share is computed from the basis as it stood then, which is exactly the drift
  -- the screening audit can only call 'review'. The replay knows the order, so it
  -- must be silent.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 100000000, 100, 1000000, v_fund_ok,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_ok_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
     principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-02-01', 55000000, v_fund_ok, 50000000, 50,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-03-01', 60000000, 50, 1200000, v_fund_ok,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
  -- 50 of the 100 units now in the bucket, against a 110,000,000 basis → 55,000,000
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
     principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-04-01', 60000000, v_fund_ok, 55000000, 50,
          '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');

  select count(*) into v_count from public.withdrawal_ledger_replay r where r.user_id = v_user;
  if v_count <> 0 then
    select string_agg(format('%s/%s: %s', r.check_name, r.severity, r.detail), E'\n')
      into v_found from public.withdrawal_ledger_replay r where r.user_id = v_user;
    raise exception 'the replay complained about a ledger the invariant itself accepted:%s%s', E'\n', v_found;
  end if;

  -- ── two claims the ledger records no order between ────────────────────────
  -- Still with the triggers ON, because this pair IS legal — 34 units taking 339
  -- of 1000/100 (owing 340), then 32 of the 66 left taking 319 (owing 320), and
  -- the invariant accepted both in that order. What it does not record is that
  -- order: now() is transaction-stable, so two withdrawals written by separate
  -- statements of ONE transaction share a created_at exactly, and transaction_id
  -- is a random uuid — it invents an order, it does not recover one. Replayed the
  -- other way round the 34-unit row owes 341 and is two đồng out, so the replay
  -- would call a legal ledger proven corrupt if it trusted its own tie-break.
  --
  -- It sits outside the clean half deliberately: the replay is NOT silent here,
  -- and it should not be. It reports what it found and says 'review'.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000, 100, 10, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_tie;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 339, v_tie, 339, 34,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_tie_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 319, v_tie, 319, 32,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_tie_b;

  -- ═══ the sequences only a replay can decide ════════════════════════════════
  -- Planted with the triggers off: every one of these is a shape the invariant
  -- refuses to write, which is the whole reason they can only be found afterwards.
  set constraints investment_transactions_source_backs_claims, investment_transactions_source_deleted immediate;
  alter table public.investment_transactions disable trigger user;

  -- ── the headline case from #613 ────────────────────────────────────────────
  -- 1000 đồng over 100 units, two sales of 50 units taking 497 and 503. The totals
  -- are exactly proportional and each per-sale deviation is inside what a legal
  -- two-sale ledger shows elsewhere, so no predicate over the final state can
  -- separate it — the screening audit is silent, and a test there pins that
  -- silence. Neither sale can be written first (50 of 100 units must take 500) and
  -- neither can follow the other, so no ordering makes it legal.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000, 100, 10, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_cancel;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 497, v_cancel, 497, 50,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_cancel_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 503, v_cancel, 503, 50,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  returning transaction_id into v_cancel_b;

  -- ── a fund sell that outran the purchases it now looks backed by ───────────
  -- 50 units bought, 100 sold, 50 more bought afterwards. The bucket's totals
  -- balance perfectly, so the screening audit sees nothing; at the moment the sell
  -- was written only half its units existed.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 50000000, 50, 1000000, v_fund_late,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
     principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-02-01', 110000000, v_fund_late, 100000000, 100,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_early;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-03-01', 50000000, 50, 1000000, v_fund_late,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');

  -- ── the same impossible pair, on a holding that was EDITED afterwards ──────
  -- A replay reconstructs history from rows as they are NOW, so a row touched
  -- after it was written is measured against a balance that may never have
  -- existed. That is the premise, and where it does not hold the finding drops to
  -- 'review' rather than claiming proof it cannot have.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000, 100, 10, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z')
  returning transaction_id into v_edited;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 497, v_edited, 497, 50,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_edited_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 503, v_edited, 503, 50,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');

  -- ── the impossible pair, written at ONE instant ────────────────────────────
  -- The 497/503 ledger again, this time sharing a created_at — the shape a single
  -- RPC writes, where transaction_id is the only tie-break and it recovers no
  -- order at all. Beside the legal pair above it pins what the ordering search
  -- actually keys on: not how the rows are timestamped, but whether any reading of
  -- them is legal. This one has none in either order and stays proven.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000, 100, 10, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_inst;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 497, v_inst, 497, 50,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_inst_a;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 503, v_inst, 503, 50,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_inst_b;

  -- ── a claim on someone ELSE'S holding ──────────────────────────────────────
  -- check_withdrawal_balance looks for the parent under the claimant's own
  -- user_id, finds nothing, and returns without measuring anything: ownership is a
  -- different trigger's refusal (#474 / #525), and staying quiet keeps that message
  -- the one the user sees. The replay has to match that silence, and the reason is
  -- specific — judging it means partitioning the holding under its owner and the
  -- claim under the claimant, so the claim replays against an opening balance of
  -- zero and reads as a pristine overdraw of a holding nobody touched. The
  -- screening view is silent here too, which the header records rather than
  -- letting the silence pass for a clean bill.
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-replay-other@test.invalid')
  returning id into v_other;
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Theirs')
  returning goal_id into v_other_g;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, created_at, updated_at)
  values (v_other, v_other_g, 'bank', 'investment', '2026-01-01', 100000000,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_foreign;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 30000000, v_foreign, 30000000,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_foreign_w;

  -- ── a shape the screening view already owns ────────────────────────────────
  -- A gold sale with units and no principal. The invariant refuses it before the
  -- allocation rule is ever reached ("must record a positive principal_withdrawn")
  -- and withdrawal_ledger_audit names it withdrawal_missing_principal. The replay
  -- must stay out of it: judged as an allocation, the row reads "it should have
  -- taken 10,000,000 đồng, it took 0", which describes a misallocation where the
  -- defect is that no principal was recorded at all — the same row, a second time,
  -- under a worse name. The two views are advertised as complements, and this is
  -- the test of that word.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 40000000, 4, 10000000,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_shape;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_shape, null, 1,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_shape_w;

  -- ── the one order the ledger DOES record ───────────────────────────────────
  -- A claim parented to a purchase cannot have been written before that purchase
  -- existed — the foreign key would have refused it. That is a fact about the
  -- schema rather than a guess about clocks, and it is the only ordering fact this
  -- view is entitled to use.
  --
  -- This ledger turns on it. Purchases of 1000/100 and 1000/10, a 500/5 claim on
  -- the SECOND, and a sale of 50 units taking 263. Every reading that puts the
  -- claimed purchase before its claim refuses the sale — the balances it could
  -- have met are 1000/100 (owes 500), 2000/110 (owes 909), 1500/105 (owes 714),
  -- 500/5 and 1000/10 (both short of 50 units). Exactly one subset makes 263
  -- correct: 1000/100 with the claim already taken and its own purchase still to
  -- come, which is the one history that could not have happened. Without the
  -- dependency the search finds that reading and downgrades a provably impossible
  -- ledger to 'review'.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 1000, 100, 10, v_fund_dep,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-02-01', 1000, 10, 100, v_fund_dep,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_dep_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 500, v_dep_buy, 500, 5,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
     principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-04-01', 263, v_fund_dep, 263, 50,
          '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')
  returning transaction_id into v_dep_sell;

  -- ── past the search's reach ────────────────────────────────────────────────
  -- The ordering search is capped at 14 movable events per key, and the cap is a
  -- resource bound rather than a tolerance — beyond it the answer is unknown, not
  -- forgiven. Fifteen claims of the same shape as a provable pair therefore report
  -- 'review': the replay still names the row and the balance, it just cannot say
  -- no ordering explains it. Ordinary holdings sit far below this.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1000, 100, 10, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_big;
  for i in 1..15 loop
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
    values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 33, v_big, 33, 5,
            timestamptz '2026-02-01T00:00:00Z' + (i * interval '1 day'),
            timestamptz '2026-02-01T00:00:00Z' + (i * interval '1 day'));
  end loop;

  -- ── a bank holding drawn past zero by its second withdrawal ────────────────
  -- The screening audit reports this holding too; what the replay adds is WHICH
  -- row broke it and the balance it was measured against.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_bank_over;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 80000000, v_bank_over, 80000000,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-01', 80000000, v_bank_over, 80000000,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  returning transaction_id into v_bank_w2;

  -- ── a fund bucket's OTHER kind of claim ────────────────────────────────────
  -- A withdrawal parented to a fund PURCHASE is not fund-keyed, so it is measured
  -- on the parent axis — but 20260803000005 also charges it against that
  -- purchase's bucket when the next sale is measured (#606). A 10-unit legacy
  -- claim on a 50-unit purchase leaves 40, and the 45-unit sell that follows is
  -- refused by the live invariant in those words. Counting only the fund-keyed
  -- sells replays it as 45 of 50 and reports clean.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-01-01', 50000000, 50, 1000000, v_fund,
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
  returning transaction_id into v_legacy_buy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 10000000, v_legacy_buy, 10000000, 10,
          '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')
  returning transaction_id into v_legacy;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
     principal_withdrawn, units_withdrawn, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'withdrawal', '2026-03-01', 45000000, v_fund, 45000000, 45,
          '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
  returning transaction_id into v_legacy_sell;
  -- and a purchase afterwards that squares the bucket's totals, so the screening
  -- audit — which sums both kinds of claim against both purchases — sees 55 units
  -- bought and 55 sold and is silent. Only the order says the sell came first.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
  values (v_user, v_goal, 'fund', 'investment', '2026-04-01', 5000000, 5, 1000000, v_fund,
          '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z');

  alter table public.investment_transactions enable trigger user;
  set constraints investment_transactions_source_backs_claims, investment_transactions_source_deleted deferred;

  -- ═══ what the replay must say ══════════════════════════════════════════════

  -- the headline case: named, as a violation, on the FIRST of the two sales, and
  -- invisible to the screening audit
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r
   where r.transaction_id = v_cancel_a;
  if v_found is distinct from 'sale_took_the_wrong_basis/violation' then
    raise exception 'the 497/503 pair should be a proven violation on its first sale, got %', coalesce(v_found, '(silence)');
  end if;
  if exists (select 1 from public.withdrawal_ledger_replay r where r.transaction_id = v_cancel_b) then
    raise exception 'only the FIRST row that could not have been written should be reported, not every later one';
  end if;
  select count(*) into v_audit from public.withdrawal_ledger_audit a
   where a.parent_transaction_id = v_cancel or a.transaction_id in (v_cancel_a, v_cancel_b);
  if v_audit <> 0 then
    raise exception 'the screening audit was supposed to be silent here — this fixture no longer proves the replay adds anything';
  end if;

  -- the detail has to carry the state the row was measured against, which is what
  -- makes a finding repairable rather than merely alarming
  select r.detail into v_found from public.withdrawal_ledger_replay r where r.transaction_id = v_cancel_a;
  if v_found not like '%1000%' or v_found not like '%100 units%' or v_found not like '%500%' then
    raise exception 'the detail should report the balance at that turn and the basis owed, got %', v_found;
  end if;

  -- the fund sell that outran its purchases: found, and deliberately NOT proven.
  -- Ordering both purchases ahead of the sell is a legal reading of these rows —
  -- the sell would then take all 100 units and the whole basis — and created_at
  -- cannot rule it out, because created_at is transaction-start and a purchase
  -- written in a long transaction can land after a later-starting sell. So the
  -- search finds a legal order and the finding says 'review'. This is the class
  -- the ordering search costs us, and the test states the cost rather than hiding
  -- it: the screening audit is silent here, and the replay still speaks.
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r where r.transaction_id = v_early;
  if v_found is distinct from 'sale_exceeded_the_units_left/review' then
    raise exception 'a sell of 100 units against a 50-unit bucket should be reported, unproven, got %', coalesce(v_found, '(silence)');
  end if;
  select count(*) into v_audit from public.withdrawal_ledger_audit a where a.fund_id = v_fund_late;
  if v_audit <> 0 then
    raise exception 'the screening audit was supposed to be silent on the late-purchase bucket';
  end if;

  -- the edited holding: same impossible pair, but the premise no longer holds
  select r.severity into v_found
    from public.withdrawal_ledger_replay r where r.transaction_id = v_edited_a;
  if v_found is distinct from 'review' then
    raise exception 'a finding on a holding edited after its sales must not claim proof, got %', coalesce(v_found, '(silence)');
  end if;

  -- the bank overdraw: the replay names the row, where the screening audit names
  -- only the holding
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r where r.transaction_id = v_bank_w2;
  if v_found is distinct from 'withdrawal_exceeded_the_balance/violation' then
    raise exception 'the second bank withdrawal should be named as the row that broke the holding, got %', coalesce(v_found, '(silence)');
  end if;
  -- and placed in the holding's history, not merely in the list of failures: this
  -- is the SECOND of two withdrawals, and an operator opening the ledger needs
  -- that number to be the one they can count to.
  select r.detail into v_found from public.withdrawal_ledger_replay r where r.transaction_id = v_bank_w2;
  if v_found not like '%20000000 đồng left, 2 of 2 withdrawal(s)%' then
    raise exception 'the detail should place the row at its turn in the holding''s history, got %', v_found;
  end if;

  -- the bucket's legacy claim: the sell that followed it is named, in the same
  -- words the live invariant refuses it with ("the remaining balance of 40 units")
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r where r.transaction_id = v_legacy_sell;
  -- Reported, and 'review' for the same reason as the bucket above: the 5-unit
  -- purchase that squares the totals could be read as arriving before the sell.
  -- What this fixture is here to prove is that the bucket's OTHER kind of claim is
  -- counted at all — without it the sell replays against 50 units and there is no
  -- finding to grade.
  if v_found is distinct from 'sale_exceeded_the_units_left/review' then
    raise exception 'a 45-unit sell behind a 10-unit legacy claim on a 50-unit purchase should be reported, got %',
      coalesce(v_found, '(silence)');
  end if;
  select r.detail into v_found from public.withdrawal_ledger_replay r where r.transaction_id = v_legacy_sell;
  if v_found not like '%40 units left%' then
    raise exception 'the bucket had 40 units left once the legacy claim is counted, got %', v_found;
  end if;
  -- and the tally counts the legacy claim, saying CLAIMS rather than sales. It is
  -- the second of two claims on this bucket though it is the only sale of it, and
  -- that other claim is the reason it does not fit — an operator who cannot see it
  -- in the count goes looking for a second sale that is not there.
  if v_found not like '%2 of 2 claim(s)%' then
    raise exception 'the tally should place the sale among the bucket''s claims, got %', v_found;
  end if;
  -- and the screening audit does not report the overdraw: its bucket sums count
  -- the fund-keyed sells alone, so 45 of 50 units looks like it fits
  select count(*) into v_audit from public.withdrawal_ledger_audit a
   where a.fund_id = v_fund and a.severity = 'violation';
  if v_audit <> 0 then
    raise exception 'the screening audit was supposed to miss the legacy-claim overdraw';
  end if;

  -- the legal tied pair: never proof. Which of its two orders the tie-break picks
  -- is itself random — transaction_id is a uuid — so whether this key produces a
  -- finding at all varies from run to run, and asserting the finding would be
  -- asserting the coin flip. What must hold on every run is the bound: this ledger
  -- is legal, and no run may call it proven corrupt.
  select r.severity into v_found
    from public.withdrawal_ledger_replay r
   where r.transaction_id in (v_tie_a, v_tie_b);
  if v_found = 'violation' then
    raise exception 'a legal ledger whose write order the database never recorded was called a proven violation';
  end if;

  -- the impossible pair at one instant: still PROVEN. Sharing a created_at costs a
  -- finding nothing by itself — what would cost it is a legal reading, and this
  -- pair has none in either order. The pair above and this one are the two halves
  -- of that distinction, and they differ only in their numbers.
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r
   where r.transaction_id in (v_inst_a, v_inst_b);
  if v_found is distinct from 'sale_took_the_wrong_basis/violation' then
    raise exception 'a pair with no legal reading stays proven however its rows are timestamped, got %',
      coalesce(v_found, '(silence)');
  end if;

  -- the claim on another user's holding: silent, and silent for BOTH users — the
  -- holding's owner must not see an overdraw of a holding nobody touched either
  if exists (select 1 from public.withdrawal_ledger_replay r
              where r.transaction_id = v_foreign_w or r.parent_transaction_id = v_foreign
                 or r.user_id = v_other) then
    select r.check_name || '/' || r.severity || ': ' || r.detail into v_found
      from public.withdrawal_ledger_replay r
     where r.transaction_id = v_foreign_w or r.parent_transaction_id = v_foreign or r.user_id = v_other;
    raise exception 'a claim naming another user''s holding is not a balance question — the invariant returns quietly and so must this: %', v_found;
  end if;

  -- the shape the screening view owns: named there, and silent here
  if exists (select 1 from public.withdrawal_ledger_replay r where r.transaction_id = v_shape_w) then
    select r.check_name || '/' || r.detail into v_found
      from public.withdrawal_ledger_replay r where r.transaction_id = v_shape_w;
    raise exception 'a row the screening view already condemns by shape must not be restated as a balance finding: %', v_found;
  end if;
  if not exists (select 1 from public.withdrawal_ledger_audit a
                  where a.transaction_id = v_shape_w and a.check_name = 'withdrawal_missing_principal') then
    raise exception 'the screening view was supposed to own this shape — if it no longer does, the replay must stop deferring to it';
  end if;

  -- the claim-to-purchase dependency: the sale is proven, because the only reading
  -- that excuses it puts a claim before the purchase it names
  select r.check_name || '/' || r.severity into v_found
    from public.withdrawal_ledger_replay r where r.transaction_id = v_dep_sell;
  if v_found is distinct from 'sale_took_the_wrong_basis/violation' then
    raise exception 'a ledger whose only legal reading predates a claim''s own purchase should stay proven, got %',
      coalesce(v_found, '(silence)');
  end if;

  -- past the search's reach: reported, and honest that it is not proof
  select r.severity into v_found
    from public.withdrawal_ledger_replay r where r.parent_transaction_id = v_big;
  if v_found is distinct from 'review' then
    raise exception 'a holding with more claims than the search can order must not claim proof, got %',
      coalesce(v_found, '(silence)');
  end if;

  -- and nothing beyond the holdings planted above. The legal tied pair is excluded
  -- for the reason above — it contributes a row or no row depending on the
  -- tie-break, and it is the only fixture here that may do either.
  select count(*) into v_count from public.withdrawal_ledger_replay r
   where r.user_id = v_user and r.parent_transaction_id is distinct from v_tie;
  if v_count <> 8 then
    select string_agg(format('%s/%s: %s', r.check_name, r.severity, r.detail), E'\n')
      into v_found from public.withdrawal_ledger_replay r where r.user_id = v_user;
    raise exception 'expected exactly the 8 planted sequences, got %:%s%s', v_count, E'\n', v_found;
  end if;

  raise notice 'withdrawal_ledger_replay: ok';
end $$;

-- ═══ the false-positive half, at scale ══════════════════════════════════════
-- The fixtures above prove the replay CATCHES. This proves it does not cry wolf,
-- which is the property that decides whether anyone ever reads its output.
--
-- Legal ledgers are not asserted to be legal here — they are BUILT with the
-- invariant watching, one write at a time, in the order the replay will read them.
-- Every insert below therefore has check_withdrawal_balance's own signature on it,
-- and a single finding is a false positive by construction. The generator pushes
-- each sale to the edge of what the rule allows (the đồng of rounding slack, the
-- full-sale shortcut, slices small enough that their share rounds to nothing),
-- because the middle of the range was never where the disagreements were.
--
-- Seeded, so a failure here is reproducible rather than a coin flip in CI.
do $$
declare
  v_user    uuid;
  v_goal    uuid;
  v_fund    uuid;
  v_src     uuid;
  v_basis   bigint;
  v_units   numeric;
  v_left    bigint;
  v_left_u  numeric;
  v_take_u  numeric;
  v_take_p  bigint;
  v_when    timestamptz;
  v_sales   int;
  v_found   text;
  i         int;
  j         int;
begin
  perform setseed(0.613);
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-replay-fuzz@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Fuzz') returning goal_id into v_goal;

  -- ── gold: one source, sales drawn down in sequence ────────────────────────
  for i in 1..120 loop
    -- Four magnitudes of basis and units, so the tiny holdings where every share
    -- rounds to zero get the same exercise as the ordinary ones.
    v_basis := (1 + floor(random() * 1000))::bigint * (10 ^ (floor(random() * 4)))::bigint;
    v_units := round((0.5 + random() * 100)::numeric, 4);
    v_when  := timestamptz '2026-01-01T00:00:00Z' + (i * interval '1 day');
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, created_at, updated_at)
    values (v_user, v_goal, 'gold', 'investment', '2026-01-01', v_basis, v_units, 1, v_when, v_when)
    returning transaction_id into v_src;

    v_left := v_basis; v_left_u := v_units;
    v_sales := 1 + floor(random() * 5);
    for j in 1..v_sales loop
      exit when v_left_u <= 0;
      -- Sometimes close the holding outright, which is the branch that takes the
      -- whole remaining basis rather than a share of it.
      if random() < 0.3 or j = v_sales then
        v_take_u := v_left_u;
        v_take_p := v_left;
      else
        v_take_u := round((v_left_u * (0.05 + random() * 0.8))::numeric, 4);
        exit when v_take_u <= 0;
        v_take_p := round(v_take_u * v_left / v_left_u);
        -- Spend the đồng of slack the rule allows, in whichever direction.
        v_take_p := v_take_p + (floor(random() * 3) - 1)::bigint;
      end if;
      -- A parent-backed withdrawal must also record a positive principal, which is
      -- what lets three đồng legally leave a one đồng holding.
      if v_take_p < 1 then v_take_p := 1; end if;
      v_when := v_when + interval '1 hour';
      insert into public.investment_transactions
        (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
         parent_transaction_id, principal_withdrawn, units_withdrawn, created_at, updated_at)
      values (v_user, v_goal, 'gold', 'withdrawal', '2026-06-01', v_take_p, v_src, v_take_p, v_take_u, v_when, v_when);
      v_left := v_left - v_take_p; v_left_u := v_left_u - v_take_u;
    end loop;
  end loop;

  -- ── fund buckets: purchases INTERLEAVED with sells ────────────────────────
  -- The case the parent axis cannot produce, and the one the screening audit can
  -- only call 'review': a purchase landing between two sells moves the ratio the
  -- second sell is measured against.
  for i in 1..80 loop
    insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'Fuzz ' || i, 'FZ' || lpad(i::text, 3, '0'), 'equity', 20000)
    returning id into v_fund;
    v_when := timestamptz '2026-01-01T00:00:00Z' + (i * interval '1 day');
    v_left := 0; v_left_u := 0;
    for j in 1..(2 + floor(random() * 5)) loop
      if j = 1 or random() < 0.4 then
        v_basis := (1 + floor(random() * 1000))::bigint * (10 ^ (floor(random() * 4)))::bigint;
        v_units := round((0.5 + random() * 100)::numeric, 4);
        v_when := v_when + interval '1 hour';
        insert into public.investment_transactions
          (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price, fund_id, created_at, updated_at)
        values (v_user, v_goal, 'fund', 'investment', '2026-01-01', v_basis, v_units, 1, v_fund, v_when, v_when);
        v_left := v_left + v_basis; v_left_u := v_left_u + v_units;
      else
        exit when v_left_u <= 0;
        if random() < 0.3 then
          v_take_u := v_left_u; v_take_p := v_left;
        else
          v_take_u := round((v_left_u * (0.05 + random() * 0.8))::numeric, 4);
          exit when v_take_u <= 0;
          v_take_p := round(v_take_u * v_left / v_left_u) + (floor(random() * 3) - 1)::bigint;
          -- A fund sell may legitimately take nothing: unlike the parent axis it
          -- has no positive-principal rule, only the proportional one.
          if v_take_p < 0 then v_take_p := 0; end if;
        end if;
        v_when := v_when + interval '1 hour';
        insert into public.investment_transactions
          (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id,
           principal_withdrawn, units_withdrawn, created_at, updated_at)
        -- amount_vnd is the row's own cash figure and must be positive; the
        -- principal the replay measures is principal_withdrawn beside it.
        values (v_user, v_goal, 'fund', 'withdrawal', '2026-06-01', greatest(v_take_p, 1), v_fund, v_take_p, v_take_u, v_when, v_when);
        v_left := v_left - v_take_p; v_left_u := v_left_u - v_take_u;
      end if;
    end loop;
  end loop;

  select string_agg(format('%s/%s: %s', r.check_name, r.severity, r.detail), E'\n')
    into v_found from public.withdrawal_ledger_replay r where r.user_id = v_user;
  if v_found is not null then
    raise exception 'the replay flagged ledgers the invariant itself wrote:%s%s', E'\n', v_found;
  end if;

  raise notice 'withdrawal_ledger_replay fuzz: ok';
end $$;

-- An operator tool, like the screen it extends: no screen reads it, and granting
-- it would add a PostgREST surface for nothing.
do $$
begin
  if has_table_privilege('authenticated', 'public.withdrawal_ledger_replay', 'select')
     or has_table_privilege('anon', 'public.withdrawal_ledger_replay', 'select') then
    raise exception 'withdrawal_ledger_replay should not be reachable from the API roles';
  end if;
end $$;

rollback;
