-- A collapse says so itself; it is not inferred from a snapshot (#652).
--
-- Two guards from #649 decide "is this delete/rewrite part of a collapse?" by
-- looking for a renewal snapshot written by the CURRENT transaction:
--
--   s.renewed_from_transaction_id = <book> and s.xmin = pg_current_xact_id()::xid
--
-- That is a proxy, not a boundary. `renewed_from_transaction_id` is an ordinary
-- column an authenticated client can write, so the evidence is forgeable; and it
-- is transaction-wide, so anything sharing a collapse's transaction inherits it.
-- Neither was reachable through PostgREST — one statement per request — which
-- made the protection a property of the API surface rather than of the database.
--
-- collapse_accumulating_book now marks its own writes with a transaction-local
-- flag (`app.collapse_write`), the same instrument successor_deposit_tx_id uses
-- (20260811000001), and the guards key off that. No client can set it.
--
-- This file forges the evidence in the same transaction as the write it is meant
-- to license — which psql can do and a REST client cannot — and asserts both
-- guards refuse anyway. That the REAL collapse still passes them is pinned by
-- merge_successor_book.test.sql ("successor still collapses"), which calls the
-- RPC for real; a future recreation of it that drops the flag fails there.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user   uuid;
  v_goal   uuid;
  v_book   uuid;  -- the successor book's anchor
  v_tranche uuid; -- the tranche credited with another book's payout
  v_source uuid;  -- the deposit that paid it
  v_forged uuid;  -- a renewal snapshot written by hand, naming the book
  v_target uuid;
  v_count  bigint;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-marker@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'House') returning goal_id into v_goal;

  -- The shape a book merge leaves behind: an OLD book that paid out, and a
  -- successor book whose tranche was credited with that payout.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 8000000, 5.0, '2026-06-01')
  returning transaction_id into v_source;
  update public.investment_transactions set deposit_group_id = v_source where transaction_id = v_source;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date)
  values (v_user, v_goal, 'bank', 'investment', '2026-01-01', 10000000, 5.5, '2027-01-01')
  returning transaction_id into v_book;
  update public.investment_transactions set deposit_group_id = v_book where transaction_id = v_book;

  -- merged_from_book_id is what marks the tranche as credited — and what the
  -- delete guard's WHEN clause keys on, so the fixture is not exercising
  -- anything without it.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date,
     deposit_group_id, merged_from_book_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 20000000, 5.5, '2027-01-01', v_book, v_source)
  returning transaction_id into v_tranche;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
     investment_date, amount_vnd, principal_withdrawn, affects_progress, consumed_by_inv_id)
  values (v_user, v_goal, 'bank', 'withdrawal', v_source,
          '2026-03-01', 8000000, 8000000, true, v_tranche);

  -- ── the forgery ─────────────────────────────────────────────────────────────
  -- Exactly what the guards used to accept as proof: a row carrying
  -- renewed_from_transaction_id = the book, written by this transaction. Nothing
  -- refuses writing it — that is the point.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd,
     renewed_from_transaction_id, affects_progress)
  values (v_user, v_goal, 'bank', 'investment', '2026-02-01', 20000000, v_book, false)
  returning transaction_id into v_forged;

  -- ── 1) the lineage must not walk up to the book on forged evidence ──────────
  -- On its own this move is step one of taking the payout: with nothing left
  -- pointing at the credited tranche, deleting it stops being refused.
  begin
    update public.investment_transactions
       set consumed_by_inv_id = v_book
     where consumed_by_inv_id = v_tranche;
    raise exception 'a forged snapshot must not license the lineage move' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  select consumed_by_inv_id into v_target
    from public.investment_transactions
   where parent_transaction_id = v_source and transaction_type = 'withdrawal';
  if v_target is distinct from v_tranche then
    raise exception 'the lineage must still name the tranche, got %', v_target;
  end if;

  -- ── 2) nor may the credited tranche be deleted on forged evidence ───────────
  -- The delete trigger asked the same question, so it accepted the same forgery:
  -- it moved the lineage itself and then let the row go, taking the payout with
  -- it while the source it emptied stayed closed for good.
  begin
    delete from public.investment_transactions where transaction_id = v_tranche;
    raise exception 'a forged snapshot must not license deleting the credited tranche' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  select count(*) into v_count from public.investment_transactions where transaction_id = v_tranche;
  if v_count <> 1 then
    raise exception 'the credited tranche must survive the refused delete';
  end if;

  -- ── 3) and the ordinary refusals still read the same ────────────────────────
  -- Without any forgery at all, which is the path a REST caller actually has.
  delete from public.investment_transactions where transaction_id = v_forged;
  begin
    delete from public.investment_transactions where transaction_id = v_tranche;
    raise exception 'the credited tranche must not be deletable on its own' using errcode = 'ZZ999';
  exception when check_violation then null;
  end;

  raise notice 'collapse_write_marker.test.sql: OK';
end $$;

rollback;
