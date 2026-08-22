-- Correcting the cash a withdrawal paid out is allowed; its CLAIM on the source
-- is what the invariants measure (#705).
--
-- A recorded withdrawal had no edit affordance at all, so a mistyped "số tiền
-- thực nhận" could only be fixed by deleting the withdrawal and recording it
-- again. The ledger now offers a narrow form for it — amount received, date,
-- notes — which is only honest if the table actually accepts that update.
--
-- The two columns are different statements. principal_withdrawn is the claim
-- against the holding, which 20260730000002 measures on every write; amount_vnd
-- on a WITHDRAWAL row is the cash the bank handed over, and it is routinely
-- LARGER than the principal (the interest) or smaller (an early-withdrawal
-- penalty). This pins that the trigger reads the claim and not the cash — if a
-- later guard starts measuring amount_vnd, the narrow edit form silently becomes
-- a form that can be refused, and this test says so first.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user uuid;
  v_goal uuid;
  v_bank uuid;
  v_wd   uuid;
  v_amt  bigint;
  v_prin bigint;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'wd-received-edit@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  insert into public.investment_transactions (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 100000000) returning transaction_id into v_bank;

  -- 60M of principal out, 61M in cash (a month of interest on top).
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, parent_transaction_id, principal_withdrawn)
  values (v_user, v_goal, 'bank', 'withdrawal', '2026-02-01', 61000000, v_bank, 60000000)
  returning transaction_id into v_wd;

  -- The bank slip said 59.5M — an early withdrawal cost the interest and then
  -- some. Correcting the cash alone must be accepted.
  update public.investment_transactions
     set amount_vnd = 59500000, updated_at = now()
   where transaction_id = v_wd;

  -- And the other way: cash well above the principal is normal, not a claim.
  update public.investment_transactions
     set amount_vnd = 63000000, updated_at = now()
   where transaction_id = v_wd;

  select amount_vnd, principal_withdrawn into v_amt, v_prin
    from public.investment_transactions where transaction_id = v_wd;

  if v_amt <> 63000000 then
    raise exception 'the corrected cash must stick, got: %', v_amt;
  end if;
  -- The claim the holding is measured against was never part of the edit.
  if v_prin <> 60000000 then
    raise exception 'the withdrawn principal must be untouched, got: %', v_prin;
  end if;

  -- The guard is still there: raising the CLAIM above what the book holds is
  -- refused, so the acceptance above is about the cash, not a hole in the check.
  begin
    update public.investment_transactions
       set principal_withdrawn = 120000000
     where transaction_id = v_wd;
    raise exception 'raising the claim above the remaining principal must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'withdrawal_received_editable: OK';
end $$;

rollback;
