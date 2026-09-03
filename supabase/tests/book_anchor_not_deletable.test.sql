-- A book's anchor cannot be deleted out from under its top-ups.
--
-- An accumulating book is a set of rows sharing a deposit_group_id, and that
-- group IS the anchor's own transaction_id. Unlike every other
-- transaction-to-transaction reference in this table, deposit_group_id carries no
-- foreign key — so nothing at all stopped the anchor from being deleted while its
-- top-ups still named it, and the ledger offers a delete button on the anchor row
-- like any other.
--
-- What that leaves is not a visible break. The group-by in goalDetailRows falls
-- back to the first surviving tranche, so the book still renders as one holding
-- and the money is still counted. It fails at maturity, months later:
-- collapse_accumulating_book reads its anchor as `transaction_id = p_group_id and
-- deposit_group_id = p_group_id`, finds nothing, and answers "accumulating book
-- not found" — the book can never be renewed again. Verified against the local
-- stack before this guard existed.
--
-- Same family as 20260903000001, and refused the same way: what makes a row
-- undeletable is what still points at it.
--
-- ─── Why a DEFERRED constraint trigger ──────────────────────────────────────
--
-- A book is dissolved as a set, not row by row — exactly the reasoning
-- enforce_deposit_book_dissolved_whole (20260802000002) gives for the UPDATE
-- side. Asked at commit, the question answers itself for every legitimate flow:
-- deleting a whole book leaves nothing naming the anchor, and so does the account
-- cascade, while deleting the anchor ALONE leaves its top-ups behind. No carve-out
-- list to keep in step with the RPCs — collapse_accumulating_book deletes only
-- non-anchor tranches, and merge_book_into_successor and withdraw_book_close_group
-- dissolve by clearing the group, never by deleting it.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user    uuid;
  v_goal    uuid;
  v_anchor  uuid;
  v_tranche uuid;
  v_msg     text;
  v_left    int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'book-anchor@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', 'PVCB', v_anchor)
  returning transaction_id into v_tranche;

  -- 1) The anchor alone is refused.
  begin
    delete from public.investment_transactions where transaction_id = v_anchor;
    set constraints all immediate;
    raise exception 'expected deleting the anchor to be refused';
  exception when sqlstate '23514' then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'deposit book:%' then
      raise exception 'expected a "deposit book:" refusal, got %', v_msg;
    end if;
  end;
  set constraints all deferred;

  select count(*) into v_left from public.investment_transactions where deposit_group_id = v_anchor;
  if v_left <> 2 then
    raise exception 'the refused delete disturbed the book: % row(s) left', v_left;
  end if;

  -- 2) A top-up is not an anchor: removing one is an ordinary ledger correction
  --    and nothing names it, so it still goes.
  delete from public.investment_transactions where transaction_id = v_tranche;
  set constraints all immediate;
  set constraints all deferred;

  -- 3) With the last top-up gone the anchor names only itself, so it goes too.
  --    The guard is about what OTHER rows still point at, never a permanent freeze.
  delete from public.investment_transactions where transaction_id = v_anchor;
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- 4) Deleting a whole book at once is allowed: at commit nothing is left naming
--    the anchor, which is the only thing the guard measures.
do $$
declare
  v_user   uuid;
  v_goal   uuid;
  v_anchor uuid;
  v_left   int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'book-anchor-whole@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', v_anchor);

  delete from public.investment_transactions where deposit_group_id = v_anchor;
  set constraints all immediate;
  set constraints all deferred;

  select count(*) into v_left from public.investment_transactions where user_id = v_user;
  if v_left <> 0 then
    raise exception 'deleting the whole book should have left nothing, % row(s) remain', v_left;
  end if;
end $$;

-- 5) A real collapse still works. It deletes every non-anchor tranche and then
--    clears the anchor's group, so a guard that measured the wrong moment would
--    break the one flow books exist for.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_tranche   uuid;
  v_collapsed public.investment_transactions;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'book-anchor-collapse@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', 'PVCB', v_anchor)
  returning transaction_id into v_tranche;

  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 37000000,
    p_interest_rate    => 5.0,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor, v_tranche],
    p_tranche_interest => array[500000::bigint, 400000::bigint]
  );
  set constraints all immediate;
  set constraints all deferred;

  if v_collapsed.deposit_group_id is not null then
    raise exception 'a collapsed book should no longer be a book';
  end if;
end $$;

-- 6) The account cascade removes anchor and top-ups together, so nothing is left
--    owing and the delete must go through.
do $$
declare
  v_user   uuid;
  v_goal   uuid;
  v_anchor uuid;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'book-anchor-cascade@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', v_anchor);

  delete from auth.users where id = v_user;
  set constraints all immediate;
  set constraints all deferred;

  if exists (select 1 from public.investment_transactions where user_id = v_user) then
    raise exception 'the account cascade left the book behind';
  end if;

  raise notice 'book_anchor_not_deletable.test.sql: OK';
end $$;

rollback;
