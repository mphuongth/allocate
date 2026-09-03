-- A source may never be edited or deleted below what has already been withdrawn
-- from it (#608).
--
-- 20260730000002 measures a WITHDRAWAL against its holding whenever the
-- withdrawal is written or relocated. Nothing measured the holding when the
-- HOLDING moved: editing a purchase down, or deleting one, left the ledger owing
-- more than it holds and raised nothing. That migration's own header names this
-- as the mirror hole; this is the other half.
--
--   buy 100,000,000 → sell 80,000,000 → edit the buy down to 50,000,000
--
-- was accepted, and dashboard/overview then does `totalInvested -= 80,000,000`
-- against a 50,000,000 basis: invested capital goes negative, the goal's progress
-- bar with it, and nothing on screen says so.
--
-- The two balances are the same two the withdrawal invariant measures, so the
-- source-side check asks the same question from the other end:
--   • bank / gold / stock — one source row: amount_vnd and units must cover every
--     claim parented to it.
--   • fund — the (goal, fund) bucket, measured by check_fund_bucket_solvent, which
--     since #606 counts fund-keyed sells AND claims parented to a purchase in it.
--
-- The edit check is DEFERRED to commit, because renewal rewrites a source's
-- amount_vnd before it re-parents that source's withdrawals onto the history
-- snapshot — a transaction that is legitimately insolvent in the middle and sound
-- at the end. Every refusal below therefore forces it with `set constraints all
-- immediate`, which is what a real transaction does by committing.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

-- ── one source row: bank and gold ───────────────────────────────────────────
do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_bank  uuid;
  v_bank_b uuid;
  v_snap  uuid;
  v_gold  uuid;
  v_drift uuid;
  v_tiny  uuid;
  v_stock uuid;
  i       int;
  v_claimed bigint;
  v_msg   text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-parent@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;
  -- Something for a renewal stamp to point at, further down.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1) returning transaction_id into v_bank_b;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 80000000, v_bank, 80000000);

  -- The issue's repro.
  begin
    update public.investment_transactions set amount_vnd = 50000000 where transaction_id = v_bank;
    set constraints all immediate;
    raise exception 'shrinking a deposit below what has been withdrawn from it must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  set constraints all deferred;
  -- The routes map this whole family to a 400 on the prefix, so the wording is a
  -- contract, not a detail (see PUT /api/v1/investment-transactions/[id]).
  if v_msg not like '%withdrawal invariant:%' or v_msg not like '%owing%' then
    raise exception 'the refusal must be a withdrawal-invariant "left owing" message, got: %', v_msg;
  end if;

  -- Exactly what is out: the boundary is allowed, not off by one. A deposit worth
  -- nothing left is a real end state — everything was withdrawn.
  update public.investment_transactions set amount_vnd = 80000000 where transaction_id = v_bank;
  set constraints all immediate;
  set constraints all deferred;

  -- One đồng under it is not.
  begin
    update public.investment_transactions set amount_vnd = 79999999 where transaction_id = v_bank;
    set constraints all immediate;
    raise exception 'one đồng below the withdrawn total must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Growing a holding is never in question.
  update public.investment_transactions set amount_vnd = 120000000 where transaction_id = v_bank;
  set constraints all immediate;
  set constraints all deferred;

  -- A holding that stops being one takes its whole balance away — the same hole
  -- through a different column, and the reason transaction_type is watched.
  begin
    update public.investment_transactions set transaction_type = 'withdrawal' where transaction_id = v_bank;
    set constraints all immediate;
    raise exception 'turning a holding into a withdrawal under a claim must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Stamping a LIVE deposit as renewal history takes its whole balance away
  -- without touching a single number on it: active_investment_transactions
  -- excludes history, so the dashboard has no holding left for the claim to apply
  -- to and both leave the totals together. The fund half of this is refused
  -- through the bucket; this is the same act on the parent axis.
  begin
    update public.investment_transactions set renewed_from_transaction_id = v_bank_b
     where transaction_id = v_bank;
    set constraints all immediate;
    raise exception 'filing a live holding as renewal history under a claim must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- But a snapshot the renewal RPCs actually wrote must keep working: it is
  -- INSERTED as history and partial withdrawals are re-parented onto it (#585),
  -- which is how a renewed deposit stops double-counting them. Those claims are
  -- inert by design, so measuring them against it would refuse the renewal itself.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, renewed_from_transaction_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, v_bank_b) returning transaction_id into v_snap;
  update public.investment_transactions set parent_transaction_id = v_snap
   where parent_transaction_id = v_bank and transaction_type = 'withdrawal';
  update public.investment_transactions set amount_vnd = 100000001 where transaction_id = v_snap;
  set constraints all immediate;
  set constraints all deferred;

  -- ── gold: the quantity is a balance too ───────────────────────────────────
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 80000000, 10, 8000000) returning transaction_id into v_gold;

  -- 6 chỉ out, at the proportional share of the basis the invariant requires.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 50000000, v_gold, 48000000, 6);

  -- Re-stating the holding at 4 chỉ leaves 6 sold out of 4 — refused on units
  -- even though the principal below would still fit.
  begin
    update public.investment_transactions set units = 4 where transaction_id = v_gold;
    set constraints all immediate;
    raise exception 'shrinking gold below the units already sold must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  set constraints all deferred;
  if v_msg not like '%units%' then
    raise exception 'the units refusal must name units, got: %', v_msg;
  end if;

  -- And on principal, with the units untouched.
  begin
    update public.investment_transactions set amount_vnd = 40000000 where transaction_id = v_gold;
    set constraints all immediate;
    raise exception 'shrinking gold below the basis already taken must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Exactly what is out, on both axes at once.
  update public.investment_transactions set units = 6, amount_vnd = 48000000 where transaction_id = v_gold;
  set constraints all immediate;
  set constraints all deferred;

  -- ── a ledger the invariant's own rounding put over the line ───────────────
  -- A quantity-valued sale takes the proportional share of the remaining basis,
  -- and check_withdrawal_balance accepts it a đồng either way because that is what
  -- rounding a slice produces. So a run of sales it ACCEPTS can sum past the
  -- holding: the four below claim 101 against a basis of 100. Measured with NO
  -- tolerance at all, that ledger became uneditable — restating the same amount was
  -- refused for a drift the invariant itself licensed and no edit made worse.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 100, 4, 25) returning transaction_id into v_drift;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_drift, 26, 1),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-03-01', 1, v_drift, 26, 1),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-04-01', 1, v_drift, 25, 1),
         (v_user, v_goal, 'gold', 'withdrawal', '2026-05-01', 1, v_drift, 24, 1);

  select coalesce(sum(w.principal_withdrawn), 0) into v_claimed
    from public.investment_transactions w where w.parent_transaction_id = v_drift;
  if v_claimed <= 100 then
    raise exception 'the fixture must actually drift over the basis, got %', v_claimed;
  end if;

  -- Restating the same amount, and correcting the units upward: neither takes
  -- anything away, so neither may be refused.
  update public.investment_transactions set amount_vnd = 100 where transaction_id = v_drift;
  set constraints all immediate;
  set constraints all deferred;
  update public.investment_transactions set units = 5 where transaction_id = v_drift;
  set constraints all immediate;
  set constraints all deferred;

  -- The allowance is a đồng PER SALE, because the proportional branch has no
  -- running total and no carve-out at zero: once the remaining basis rounds to
  -- nothing, every further sale may still take its đồng. The audit suite's own
  -- legal fixture is the extreme of it — a 1 đồng / 5 chỉ holding sold in three
  -- 1-unit slices, three đồng out of one, every write accepted. Measured with a
  -- flat đồng that holding could not even have its units GROWN.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'gold', 'investment', '2026-01-01', 1, 5, 1) returning transaction_id into v_tiny;
  for i in 1..3 loop
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, 'gold', 'withdrawal', '2026-02-01', 1, v_tiny, 1, 1);
  end loop;
  update public.investment_transactions set units = 6 where transaction_id = v_tiny;
  set constraints all immediate;
  set constraints all deferred;

  -- Per sale is not unbounded, and it still rounds a real balance rather than
  -- creating one: emptied to nothing, the holding gets no đồng at all.
  begin
    update public.investment_transactions set amount_vnd = 0 where transaction_id = v_tiny;
    set constraints all immediate;
    raise exception 'an emptied holding must not inherit the rounding allowance';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Back on the four-sale ledger: four sales buy four đồng and no more.
  begin
    update public.investment_transactions set amount_vnd = 96 where transaction_id = v_drift;
    set constraints all immediate;
    raise exception 'shrinking past the per-sale rounding allowance must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- And the đồng is GOLD's, because gold is the only parent-axis holding whose
  -- principal is a rounded proportional share. check_withdrawal_balance caps bank
  -- and stock outright, so their claims can never sum past the holding and slack
  -- there is not forgiveness of rounding — it is a đồng of real overdraw the
  -- dashboard values at minus one. Units recorded on the sale must not buy it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, 'stock', 'investment', '2026-01-01', 100, 10, 10) returning transaction_id into v_stock;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'stock', 'withdrawal', '2026-02-01', 80, v_stock, 80, 8);

  begin
    update public.investment_transactions set amount_vnd = 79 where transaction_id = v_stock;
    set constraints all immediate;
    raise exception 'a stock holding must not inherit gold''s rounding allowance';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  raise notice 'one-source shrink: ok';
end;
$$;

-- ── the (goal, fund) bucket ─────────────────────────────────────────────────
do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_fund  uuid;
  v_buy   uuid;
  v_buy_b uuid;
  v_other uuid;
  v_fund_t uuid;
  v_buy_t uuid;
  v_fund_e uuid;
  v_buy_e uuid;
  i       int;
  v_msg   text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-fund@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TFX', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;
  -- Something for a renewal stamp to point at, further down.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 1) returning transaction_id into v_other;

  -- 60 of the 100 units, at the basis the allocation rule requires.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-03-01', 1200000, 1200000, 60);

  -- The issue's fund shape: re-price the purchase to 40 units and the bucket owes
  -- 60 out of 40.
  begin
    update public.investment_transactions set units = 40, amount_vnd = 800000 where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'shrinking a fund purchase below what the bucket has sold must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  set constraints all deferred;
  if v_msg not like '%withdrawal invariant:%' or v_msg not like '%bucket%' then
    raise exception 'the refusal must name the bucket, got: %', v_msg;
  end if;

  -- Exactly what the bucket has sold: allowed.
  update public.investment_transactions set units = 60, amount_vnd = 1200000 where transaction_id = v_buy;
  set constraints all immediate;
  set constraints all deferred;

  -- Clearing the UNITS is the quietest way out of a bucket, and the one a
  -- column-by-column guard misses: the fund, the asset type, the goal and the
  -- transaction type are all untouched, so nothing about the row says it moved —
  -- but the dashboard keys a fund holding on `units`, so the purchase disappears
  -- from the bucket and the sale stays. The row is measured on the parent axis by
  -- then, where a fund-keyed sell does not appear at all.
  begin
    update public.investment_transactions set units = 0 where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'clearing a fund purchase''s units under a sale must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Null is the same act spelled differently, and the PUT route accepts both.
  begin
    update public.investment_transactions set units = null where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'nulling a fund purchase''s units under a sale must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- The units epsilon is withheld when the bucket holds none. Flat, it forgave the
  -- one edit that empties a bucket whose whole quantity IS an epsilon: a
  -- 0.0001-unit purchase backing a 0.0001-unit sale, taken to zero units, passed
  -- because 0.0001 > 0 + 0.0001 is false. The purchase then leaves the fund
  -- accumulator, is valued as an ordinary holding, and its whole principal
  -- reappears on the dashboard while the sale has nothing left to reduce.
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Epsilon Fund', 'EPSF', 'equity', 20000) returning id into v_fund_e;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund_e, 'fund', 'investment', '2026-01-01', 1000000, 0.0001, 20000) returning transaction_id into v_buy_e;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund_e, 'fund', 'withdrawal', '2026-02-01', 1000000, 1000000, 0.0001);

  begin
    update public.investment_transactions set units = 0 where transaction_id = v_buy_e;
    set constraints all immediate;
    raise exception 'an epsilon-sized bucket must not be emptied on the epsilon';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- The bucket forgives the same per-sale rounding the parent axis does, and for
  -- the same reason: the fund allocation rule is checked per sale with no running
  -- total. The fund twin of the audit suite's tiny ledger — a 1 đồng / 5 unit
  -- purchase carrying three legal 1-đồng sales — was refused every later edit,
  -- including one that only GREW the purchase.
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Tiny Fund', 'TNYF', 'equity', 1) returning id into v_fund_t;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund_t, 'fund', 'investment', '2026-01-01', 1, 5, 1) returning transaction_id into v_buy_t;
  for i in 1..3 loop
    insert into public.investment_transactions
      (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
    values (v_user, v_goal, v_fund_t, 'fund', 'withdrawal', '2026-02-01', 1, 1, 1);
  end loop;
  update public.investment_transactions set units = 6 where transaction_id = v_buy_t;
  set constraints all immediate;
  set constraints all deferred;

  -- Per sale, not unbounded: emptying that bucket is still refused.
  begin
    update public.investment_transactions set units = 0.1, amount_vnd = 0 where transaction_id = v_buy_t;
    set constraints all immediate;
    raise exception 'emptying a bucket must not be forgiven as rounding';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Stamping a LIVE purchase as renewal history is the same subtraction again, and
  -- the one that leaves no trace on the row's own shape: it stays a fund purchase
  -- with its units, but every reader — and check_fund_bucket_solvent — leaves
  -- history out of the sums, so the bucket the dashboard counts drops to nothing
  -- while the sale stays. Watched because nothing about the columns above moves.
  begin
    update public.investment_transactions set renewed_from_transaction_id = v_other
     where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'filing a live purchase as renewal history under a sale must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- Leaving the fund takes the purchase out of the bucket entirely, which is the
  -- same subtraction as shrinking it to nothing.
  begin
    update public.investment_transactions set asset_type = 'bank', fund_id = null where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'moving a purchase out of a fund whose bucket has sold units must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  -- ── a claim parented to a purchase, the legacy shape #606 values ──────────
  -- Nothing writes one any more (20260803000002 refuses it), so it is produced
  -- the way the ledger already contains it: written before the guard existed.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-05', 1000000, 50, 20000) returning transaction_id into v_buy_b;

  alter table public.investment_transactions disable trigger user;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-03-05', 400000, v_buy_b, 400000, 20);
  alter table public.investment_transactions enable trigger user;

  -- The bucket now holds 60 + 50 units against 60 fund-keyed + 20 parented. Take
  -- the second purchase down to 20 units and 80 units are claimed on 80 held —
  -- the boundary, allowed.
  update public.investment_transactions set units = 20, amount_vnd = 400000 where transaction_id = v_buy_b;
  set constraints all immediate;
  set constraints all deferred;

  -- One unit further and the parented claim is what tips it: 60 fund-keyed units
  -- would still fit inside the 79 left. Before #606 this claim was invisible to
  -- the bucket, so the edit passed.
  -- NULLING the units is not the same as zeroing them, and it is worse: the
  -- dashboard drops a fund row with null units outright (the pending-DCA
  -- exclusion), so the purchase stops being valued at all. With a legacy claim
  -- parented to it, BOTH leave the dashboard together — no overdraw to find,
  -- because the holding and what draws on it vanish at the same time. The bucket
  -- recheck cannot see it either: its join excludes a purchase with no units, and
  -- so excludes that purchase's claim with it.
  begin
    update public.investment_transactions set units = null where transaction_id = v_buy_b;
    set constraints all immediate;
    raise exception 'nulling the units of a purchase carrying a claim must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  begin
    update public.investment_transactions set units = 19, amount_vnd = 380000 where transaction_id = v_buy_b;
    set constraints all immediate;
    raise exception 'a parented claim must count when its purchase is shrunk';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  raise notice 'fund-bucket shrink: ok';
end;
$$;

-- ── deleting a source ───────────────────────────────────────────────────────
do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_fund  uuid;
  v_bank  uuid;
  v_snap  uuid;
  v_buy   uuid;
  v_buy_b uuid;
  v_other uuid;
  v_msg   text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-delete@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TFX', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 60000000, v_bank, 60000000);

  -- parent_transaction_id is ON DELETE SET NULL, so deleting the deposit used to
  -- orphan its withdrawal in silence (#607): the cash stays in history, filed
  -- under no holding, and nothing subtracts it from anything ever again.
  begin
    delete from public.investment_transactions where transaction_id = v_bank;
    raise exception 'deleting a holding that still has withdrawals must be refused';
  exception when sqlstate '23514' then
    v_msg := sqlerrm;
  end;
  if v_msg not like '%withdrawal invariant:%' then
    raise exception 'the delete refusal must join the withdrawal-invariant family, got: %', v_msg;
  end if;

  -- The remedy is the ledger's own: remove the withdrawal, then the holding.
  delete from public.investment_transactions
   where parent_transaction_id = v_bank and transaction_type = 'withdrawal';
  delete from public.investment_transactions where transaction_id = v_bank;

  -- A collapse re-parents a tranche's partial withdrawals onto the history
  -- snapshot BEFORE deleting the tranche they came from (#585). That order still
  -- deletes: the moved withdrawal no longer names the row going away.
  --
  -- The snapshot names the SURVIVING anchor, not the tranche being deleted, which
  -- is what the collapse loop actually writes (renewed_from = p_group_id). Built
  -- the other way round this fixture asserted that a row could be deleted while
  -- its own renewal history pointed at it — a shape no flow produces, and the one
  -- 20260903000001 exists to refuse.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 40000000) returning transaction_id into v_other;
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 60000000, v_bank, 60000000);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, renewed_from_transaction_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, v_other) returning transaction_id into v_snap;
  update public.investment_transactions
     set parent_transaction_id = v_snap
   where parent_transaction_id = v_bank and transaction_type = 'withdrawal';
  delete from public.investment_transactions where transaction_id = v_bank;
  set constraints all immediate;
  set constraints all deferred;

  -- ── a fund purchase: the bucket decides, not the row ──────────────────────
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-05', 1000000, 50, 20000) returning transaction_id into v_buy_b;
  -- 60 of the 150 units in the bucket.
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-03-01', 1200000, 1200000, 60);

  -- The smaller purchase can go: 100 units still back the 60 sold. A fund sell
  -- names no parent, so nothing about this row's deletion is refusable on its
  -- own — only the bucket it leaves behind can answer.
  delete from public.investment_transactions where transaction_id = v_buy_b;
  set constraints all immediate;
  set constraints all deferred;

  -- The larger one cannot: 50 units would be left backing 60.
  begin
    delete from public.investment_transactions where transaction_id = v_buy;
    set constraints all immediate;
    raise exception 'deleting a purchase the bucket still needs must be refused';
  exception when sqlstate '23514' then null;
  end;
  set constraints all deferred;

  raise notice 'source delete: ok';
end;
$$;

-- ── what must still go through ──────────────────────────────────────────────
-- Every cascade and RPC that legitimately rewrites a source. A guard that stops
-- any of these is worse than the hole it closes.
do $$
declare
  v_user  uuid;
  v_goal  uuid;
  v_fund  uuid;
  v_bank  uuid;
  v_snap  uuid;
  v_buy   uuid;
  v_left  bigint;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-carveout@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TFX', 'equity', 20000) returning id into v_fund;

  -- ── renewal's statement order ─────────────────────────────────────────────
  -- renew_term_deposit_with_merge rewrites the source's amount_vnd FIRST and only
  -- then re-parents its withdrawals onto the snapshot, so the row is genuinely
  -- insolvent between the two statements. This is the whole reason the edit check
  -- is deferred to commit rather than measured at the end of each statement.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 60000000, v_bank, 60000000);

  -- 1) roll the deposit forward at its remaining balance plus interest
  update public.investment_transactions set amount_vnd = 41000000 where transaction_id = v_bank;
  -- 2) append the history snapshot of the closed cycle
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, renewed_from_transaction_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, v_bank) returning transaction_id into v_snap;
  -- 3) move the partial withdrawals onto it
  update public.investment_transactions
     set parent_transaction_id = v_snap
   where parent_transaction_id = v_bank and transaction_type = 'withdrawal';
  -- Sound at the end, which is the only place it is asked.
  set constraints all immediate;
  set constraints all deferred;

  -- ── deleting the fund ─────────────────────────────────────────────────────
  -- funds.id is ON DELETE SET NULL on this table, so the whole bucket — purchases
  -- and sells — loses its fund at once. An ordinary fund delete must not fail
  -- (the same cascade broke the withdrawal invariant once, fixed in #599).
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;
  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, principal_withdrawn, units_withdrawn)
  values (v_user, v_goal, v_fund, 'fund', 'withdrawal', '2026-03-01', 1200000, 1200000, 60);

  delete from public.funds where id = v_fund;
  set constraints all immediate;
  set constraints all deferred;

  -- ── deleting the goal ─────────────────────────────────────────────────────
  -- goal_id is ON DELETE SET NULL too: everything in the goal moves to the
  -- unallocated bucket together, so nothing is separated from what backs it.
  delete from public.savings_goals where goal_id = v_goal;
  set constraints all immediate;
  set constraints all deferred;

  -- ── deleting the user ─────────────────────────────────────────────────────
  -- The account cascade removes holdings and withdrawals in an order Postgres
  -- picks. A guard that reads a half-removed ledger as an overdraw would make an
  -- account undeletable.
  delete from auth.users where id = v_user;
  set constraints all immediate;
  set constraints all deferred;

  select count(*) into v_left from public.investment_transactions where user_id = v_user;
  if v_left <> 0 then
    raise exception 'the account cascade left % rows behind', v_left;
  end if;

  raise notice 'carve-outs: ok';
end;
$$;

rollback;
