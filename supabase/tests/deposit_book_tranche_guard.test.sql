-- A tranche cannot be converted out of its accumulating book (#593).
--
-- The edit route refuses an asset_type change on a booked deposit, but the route
-- is not the only writer: RLS lets `authenticated` UPDATE its own
-- investment_transactions rows straight through PostgREST, and the browser holds
-- that session. A direct write could flip one tranche to gold/fund — clearing
-- every bank-only column on the way, so the subtype CHECK is satisfied — and
-- strand the remaining tranches in a book whose principal no longer adds up.
-- Renewal, collapse and book withdrawal all read the book by deposit_group_id
-- and would each see a different holding than the user has.
--
-- So the rule lives on the table:
--   • while a row is in a book, its asset_type is fixed;
--   • a tranche cannot be moved into a different book;
--   • a tranche may leave a book only when the whole book is dissolved in the
--     same statement — which is exactly what collapse and a full close do.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_goal    uuid;
  v_fund    uuid;
  v_anchor  uuid;
  v_tranche uuid;
  v_other   uuid;
  v_plain   uuid;
  v_book    uuid;  -- a live book for the #618 inserts
  v_left    int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'book-guard@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
  values (v_user, 'Guard Fund', 'GRD', 'equity', 20000) returning id into v_fund;

  -- A book: the anchor self-groups, the tranche points at it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 50000000, 5.5)
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 20000000, 5.5, v_anchor)
  returning transaction_id into v_tranche;

  -- A second book, to try to move a tranche into.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 30000000)
  returning transaction_id into v_other;
  update public.investment_transactions set deposit_group_id = v_other where transaction_id = v_other;

  -- ── The bypass: a raw UPDATE that satisfies the subtype CHECK ─────────────

  -- Every stale bank column cleared, so investment_transactions_subtype_shape is
  -- happy — and the book is still left short a tranche.
  begin
    update public.investment_transactions
    set asset_type = 'gold', units = 2, unit_price = 3500000,
        interest_rate = null, expiry_date = null, bank_code = null,
        interest_earned_vnd = null
    where transaction_id = v_tranche;
    raise exception 'a booked tranche must not be converted to gold';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.investment_transactions
    set asset_type = 'fund', fund_id = v_fund, units = 100, unit_price = 20000,
        interest_rate = null, expiry_date = null, bank_code = null,
        interest_earned_vnd = null
    where transaction_id = v_tranche;
    raise exception 'a booked tranche must not be converted to a fund';
  exception when sqlstate '23514' then null;
  end;

  -- The same write that also drops out of the book in one statement: still the
  -- anchor's book losing a member, so still refused.
  begin
    update public.investment_transactions
    set asset_type = 'gold', units = 2, unit_price = 3500000, deposit_group_id = null,
        interest_rate = null, expiry_date = null, bank_code = null,
        interest_earned_vnd = null
    where transaction_id = v_tranche;
    raise exception 'a booked tranche must not be converted while leaving the book';
  exception when sqlstate '23514' then null;
  end;

  -- The anchor itself is a tranche too.
  begin
    update public.investment_transactions
    set asset_type = 'gold', units = 5, unit_price = 3500000,
        interest_rate = null, expiry_date = null, bank_code = null,
        interest_earned_vnd = null
    where transaction_id = v_anchor;
    raise exception 'a book anchor must not be converted to gold';
  exception when sqlstate '23514' then null;
  end;

  -- ── Moving between books, and leaving one behind ─────────────────────────
  begin
    update public.investment_transactions set deposit_group_id = v_other where transaction_id = v_tranche;
    raise exception 'a tranche must not be moved into another book';
  exception when sqlstate '23514' then null;
  end;

  begin
    update public.investment_transactions set deposit_group_id = null where transaction_id = v_tranche;
    raise exception 'a tranche must not leave a book that still has members';
  exception when sqlstate '23514' then null;
  end;

  -- ── What must still work ─────────────────────────────────────────────────

  -- An ordinary book edit: the fields update_deposit_book cascades, with the
  -- type and the group untouched.
  update public.investment_transactions
  set interest_rate = 6.1, expiry_date = '2027-01-01', goal_id = v_goal, notes = 'edited'
  where deposit_group_id = v_anchor;

  -- Dissolving the WHOLE book in one statement — what a full close does.
  update public.investment_transactions
  set deposit_group_id = null, updated_at = now()
  where deposit_group_id = v_anchor;

  select count(*) into v_left from public.investment_transactions where deposit_group_id = v_anchor;
  if v_left <> 0 then raise exception 'the book should have been dissolved'; end if;

  -- Collapse's shape: delete the other tranches first, then clear the anchor.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 20000000, v_other)
  returning transaction_id into v_tranche;

  delete from public.investment_transactions where transaction_id = v_tranche;
  update public.investment_transactions set deposit_group_id = null where transaction_id = v_other;

  -- And a deposit that was never in a book can still change type, provided the
  -- old subtype goes with it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 5000000, 5.5)
  returning transaction_id into v_plain;

  update public.investment_transactions
  set asset_type = 'gold', units = 1, unit_price = 3500000, interest_rate = null
  where transaction_id = v_plain;

  -- ── A book is made of bank deposits, from the first row (#618) ───────────
  --
  -- The rules above are about a row that is ALREADY in a book: it cannot change
  -- type, cannot move, cannot leave alone. None of them fires on the INSERT that
  -- puts a non-deposit into a book in the first place — and POST accepted
  -- `{ asset_type: 'fund', accumulating: true }` for exactly as long, so a fund
  -- row could carry a deposit_group_id. Every path that keys on the group ALONE
  -- reads such a row as a book: lib/mergeEligibility, update_deposit_book's
  -- cascade, and create_held_settlement, which refuses a grouped source
  -- explicitly because of it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 30000000, 5.5, '2027-01-01')
  returning transaction_id into v_book;
  update public.investment_transactions set deposit_group_id = v_book where transaction_id = v_book;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       fund_id, units, unit_price, deposit_group_id)
    values (v_user, v_goal, 'fund', 'investment', '2026-03-01', 10000000,
            v_fund, 500, 20000, v_book);
    raise exception 'a fund holding must not be born in a book';
  exception when sqlstate '23514' then null;
  end;

  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
       units, unit_price, deposit_group_id)
    values (v_user, v_goal, 'gold', 'investment', '2026-03-01', 10000000, 2, 5000000, v_book);
    raise exception 'a gold holding must not be born in a book';
  exception when sqlstate '23514' then null;
  end;

  -- The anchor of a book is a deposit, so a withdrawal has no business carrying
  -- the group: self-grouped it would read as a live book holding a balance
  -- nothing put there.
  begin
    insert into public.investment_transactions
      (user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
       investment_date, amount_vnd, principal_withdrawn, deposit_group_id)
    values (v_user, v_goal, 'bank', 'withdrawal', v_book,
            '2026-03-01', 1000000, 1000000, v_book);
    raise exception 'a withdrawal must not carry a book';
  exception when sqlstate '23514' then null;
  end;

  -- And the shape every writer actually produces still goes in.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-01', 20000000, 5.5, v_book)
  returning transaction_id into v_tranche;
  delete from public.investment_transactions where transaction_id = v_tranche;

  raise notice 'deposit book tranche guard: OK';
end $$;

rollback;
