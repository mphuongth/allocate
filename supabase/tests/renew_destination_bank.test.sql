-- Renewing a lone deposit into another bank (#640).
--
-- `bank_code` is applied by renew_term_deposit_with_merge only. The renew route
-- now reaches that function whenever a destination bank is asked for, even with
-- nothing to merge — which is the whole point: a user settling ONE maturing
-- deposit and re-depositing at another bank has no sibling to fold in, and had
-- no way to change bank at all.
--
-- That routing rests on the merge function behaving exactly like the plain one
-- when its source arrays are empty (its loop runs `1 .. coalesce(array_length,
-- 0)`). This test pins that contract, so a future edit to the merge path can't
-- quietly change what a plain renewal does.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user     uuid;
  v_goal     uuid;
  v_tx       uuid;
  v_wd       uuid;
  v_renewed  public.investment_transactions;
  v_snapshot public.investment_transactions;
  v_count    int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'renew-bank@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  -- A matured term deposit at PVCB, with one partial withdrawal on the closing
  -- cycle (so the re-parent step has something to move).
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code
  )
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 20000000, 6, '2026-07-01', 'PVCB')
  returning transaction_id into v_tx;

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  )
  values (v_user, v_goal, 'bank', 'withdrawal', v_tx, '2026-03-01', 2000000, 2000000)
  returning transaction_id into v_wd;

  -- 1) Renew with a destination bank and NO merge sources — the shape the route
  --    now sends for a plain "settle & re-deposit elsewhere".
  select * into v_renewed from public.renew_term_deposit_with_merge(
    p_tx_id              => v_tx,
    p_amount_vnd         => 19000000,
    p_interest_rate      => 6.5,
    p_expiry_date        => '2027-01-01',
    p_investment_date    => '2026-07-01',
    p_interest_earned_vnd=> 600000,
    p_fulfill_saving_id  => null,
    p_fulfill_ym         => null,
    p_fulfill_amount     => null,
    p_fulfill_source     => null,
    p_merge_source_ids   => '{}',
    p_merge_received     => '{}',
    p_bank_code          => 'VCB',
    p_held_source_ids    => '{}'
  );

  -- The bank moved, and the principal is exactly what was asked for: an empty
  -- merge list must add nothing.
  if v_renewed.bank_code is distinct from 'VCB' then
    raise exception 'expected the renewed deposit at VCB, got %', v_renewed.bank_code;
  end if;
  if v_renewed.amount_vnd <> 19000000 then
    raise exception 'an empty merge list must not change the principal, got %', v_renewed.amount_vnd;
  end if;
  if v_renewed.expiry_date <> date '2027-01-01' or v_renewed.interest_rate <> 6.5 then
    raise exception 'the new cycle did not roll forward correctly';
  end if;

  -- The closed cycle was snapshotted, at the OLD bank's figures.
  select * into v_snapshot from public.investment_transactions
   where renewed_from_transaction_id = v_tx;
  if not found then
    raise exception 'the closed cycle was not snapshotted';
  end if;
  if v_snapshot.amount_vnd <> 20000000 or v_snapshot.interest_earned_vnd <> 600000 then
    raise exception 'the snapshot does not describe the closed cycle';
  end if;

  -- The closing cycle's withdrawal was re-parented onto the snapshot — the
  -- correctness-critical step a plain renewal performs, unchanged here.
  select count(*) into v_count from public.investment_transactions
   where transaction_id = v_wd and parent_transaction_id = v_snapshot.transaction_id;
  if v_count <> 1 then
    raise exception 'the closed cycle''s withdrawal was not re-parented onto the snapshot';
  end if;

  -- No merge withdrawal was invented out of the empty source list.
  select count(*) into v_count from public.investment_transactions
   where user_id = v_user and transaction_type = 'withdrawal' and consumed_by_inv_id is not null;
  if v_count <> 0 then
    raise exception 'an empty merge list must not close any source, found % row(s)', v_count;
  end if;

  -- 2) A NULL destination leaves the bank untouched (the "no change" path the
  --    route takes for an unchanged pick).
  select * into v_renewed from public.renew_term_deposit_with_merge(
    p_tx_id              => v_tx,
    p_amount_vnd         => 19000000,
    p_interest_rate      => 6.5,
    p_expiry_date        => '2027-07-01',
    -- Same (past) anchor as step 1: the RPC rejects a future start date, and this
    -- suite must not start failing as the calendar moves past a hardcoded one.
    p_investment_date    => '2026-07-01',
    p_interest_earned_vnd=> 0,
    p_fulfill_saving_id  => null,
    p_fulfill_ym         => null,
    p_fulfill_amount     => null,
    p_fulfill_source     => null,
    p_merge_source_ids   => '{}',
    p_merge_received     => '{}',
    p_bank_code          => null,
    p_held_source_ids    => '{}'
  );
  if v_renewed.bank_code is distinct from 'VCB' then
    raise exception 'a null destination must leave the bank as is, got %', v_renewed.bank_code;
  end if;

  -- 3) The DISPLAYED name follows the money. A structured deposit stores the
  --    chosen bank's name in `notes` (that is what the goal holdings list shows),
  --    so moving the code alone left a deposit at VCB still reading "PVcomBank".
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code, notes
  )
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000, 6, '2026-07-01', 'PVCB', 'PVcomBank')
  returning transaction_id into v_tx;

  select * into v_renewed from public.renew_term_deposit_with_merge(
    p_tx_id => v_tx, p_amount_vnd => 10000000, p_interest_rate => 6,
    p_expiry_date => '2027-01-01', p_investment_date => '2026-07-01',
    p_interest_earned_vnd => 0, p_fulfill_saving_id => null, p_fulfill_ym => null,
    p_fulfill_amount => null, p_fulfill_source => null,
    p_merge_source_ids => '{}', p_merge_received => '{}',
    p_bank_code => 'VCB', p_held_source_ids => '{}'
  );
  if v_renewed.notes is distinct from 'Vietcombank' then
    raise exception 'the deposit must be relabelled for its new bank, got %', v_renewed.notes;
  end if;

  -- The closed cycle keeps the bank it was actually held at.
  select * into v_snapshot from public.investment_transactions
   where renewed_from_transaction_id = v_tx;
  if v_snapshot.notes is distinct from 'PVcomBank' then
    raise exception 'the snapshot must keep the old bank name, got %', v_snapshot.notes;
  end if;

  -- 4) A name the USER chose is theirs — moving banks must not overwrite it.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, interest_rate, expiry_date, bank_code, notes
  )
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000, 6, '2026-07-01', 'PVCB', 'Sổ cưới')
  returning transaction_id into v_tx;

  select * into v_renewed from public.renew_term_deposit_with_merge(
    p_tx_id => v_tx, p_amount_vnd => 10000000, p_interest_rate => 6,
    p_expiry_date => '2027-01-01', p_investment_date => '2026-07-01',
    p_interest_earned_vnd => 0, p_fulfill_saving_id => null, p_fulfill_ym => null,
    p_fulfill_amount => null, p_fulfill_source => null,
    p_merge_source_ids => '{}', p_merge_received => '{}',
    p_bank_code => 'VCB', p_held_source_ids => '{}'
  );
  if v_renewed.notes is distinct from 'Sổ cưới' then
    raise exception 'a user-chosen name must survive the move, got %', v_renewed.notes;
  end if;
  if v_renewed.bank_code is distinct from 'VCB' then
    raise exception 'the bank must still move for a custom-named deposit, got %', v_renewed.bank_code;
  end if;

  raise notice 'renew_destination_bank.test.sql: OK';
end $$;

rollback;
