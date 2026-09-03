-- A deposit that carries renewal history cannot be deleted out from under it.
--
-- Renewing a term deposit — and collapsing an accumulating book — does NOT create
-- a new row for the new cycle. Both roll the SAME row forward in place and append
-- a history snapshot of the cycle that closed, linked back by
-- renewed_from_transaction_id. So the row a user sees in Recent Activity dated
-- "the day I renewed" IS the deposit, not a record of the renewal, and the
-- ledger's per-row delete on it removes the whole holding.
--
-- What made that unrecoverable is the second half: the link is ON DELETE SET
-- NULL, so every snapshot silently loses its parent and re-enters the active view
-- as a live holding of a CLOSED cycle — the old principal, the old maturity, at
-- whatever rate that cycle carried. Net worth changes, the goal's holdings turn
-- into N fragments of a deposit that no longer exists, and nothing anywhere says
-- a renewal was undone. Real occurrence: a 5-tranche PVcomBank book collapsed to
-- one 55M deposit, the collapsed row deleted from Recent Activity, and the book
-- came back as five orphaned tranches with no group.
--
-- The refusal is caught at the FK's own SET NULL — a BEFORE UPDATE on the
-- SNAPSHOT — for the same reason refuse_orphaning_a_claim is (20260804000001):
-- by AFTER DELETE the link this needs to read is already gone. Two carve-outs,
-- both mirrored from that function: the source still existing means somebody
-- unlinked deliberately, and an account cascade has nothing left to protect.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user     uuid;
  v_goal     uuid;
  v_tx       uuid;
  v_snap     uuid;
  v_msg      text;
  v_left     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'renewed-del@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code
  )
  values (v_user, v_goal, 'bank', 'investment', '2026-06-03', 54000000, 4.75, '2026-09-03', 'PVCB')
  returning transaction_id into v_tx;

  perform public.renew_term_deposit(
    p_tx_id               => v_tx,
    p_amount_vnd          => 55000000,
    p_interest_rate       => 4.9,
    p_expiry_date         => '2026-12-03',
    p_investment_date     => '2026-09-03',
    p_interest_earned_vnd => 1000000
  );

  select transaction_id into v_snap
    from public.investment_transactions
   where renewed_from_transaction_id = v_tx;
  if v_snap is null then
    raise exception 'setup: expected the renewal to leave a history snapshot';
  end if;

  -- 1) The renewed deposit is not deletable while its history points at it.
  begin
    delete from public.investment_transactions where transaction_id = v_tx;
    raise exception 'expected the delete to be refused';
  exception when sqlstate '23514' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'renewal history:%' then
      raise exception 'expected a "renewal history:" refusal, got %', v_msg;
    end if;
  end;

  -- The refusal must leave BOTH rows exactly as they were — not the deposit gone
  -- and the snapshot orphaned, which is the state this whole guard exists to
  -- prevent.
  if not exists (select 1 from public.investment_transactions where transaction_id = v_tx) then
    raise exception 'the refused delete still removed the deposit';
  end if;
  if not exists (
    select 1 from public.investment_transactions
     where transaction_id = v_snap and renewed_from_transaction_id = v_tx
  ) then
    raise exception 'the refused delete still orphaned the snapshot';
  end if;

  -- 2) A snapshot is history and stays deletable — the guard is about the source.
  delete from public.investment_transactions where transaction_id = v_snap;

  -- 3) With the history gone, the deposit deletes normally. The guard is a
  --    consequence of what still points at the row, never a permanent freeze.
  delete from public.investment_transactions where transaction_id = v_tx;
  select count(*) into v_left
    from public.investment_transactions where user_id = v_user;
  if v_left <> 0 then
    raise exception 'expected the deposit to delete once its history was gone, % row(s) left', v_left;
  end if;
end $$;

-- 4) The account cascade must still work. A user deleting their account removes
--    the deposit and its snapshots together, and refusing that would strand the
--    account over history nobody is left to read — the same carve-out
--    refuse_orphaning_a_claim makes.
do $$
declare
  v_user uuid;
  v_goal uuid;
  v_tx   uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'renewed-cascade@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date
  )
  values (v_user, v_goal, 'bank', 'investment', '2026-06-03', 20000000, 5, '2026-09-03')
  returning transaction_id into v_tx;

  perform public.renew_term_deposit(v_tx, 21000000, 5, '2026-12-03', '2026-09-03', 1000000);

  delete from auth.users where id = v_user;

  if exists (select 1 from public.investment_transactions where user_id = v_user) then
    raise exception 'the account cascade left transactions behind';
  end if;
  raise notice 'renewed_deposit_not_deletable.test.sql: OK';
end $$;

rollback;
