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
  v_gold  uuid;
  v_msg   text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-parent@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;

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
  v_msg   text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'src-fund@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Test Fund', 'TFX', 'equity', 20000) returning id into v_fund;

  insert into public.investment_transactions
    (user_id, goal_id, fund_id, asset_type, transaction_type, investment_date, amount_vnd, units, unit_price)
  values (v_user, v_goal, v_fund, 'fund', 'investment', '2026-01-01', 2000000, 100, 20000) returning transaction_id into v_buy;

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

  -- Renewal and collapse re-parent partial withdrawals onto the history snapshot
  -- BEFORE removing the row they came from (#585). That order still deletes.
  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 60000000, v_bank, 60000000);
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, renewed_from_transaction_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000, v_bank) returning transaction_id into v_snap;
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
