-- A recurring saving may not be linked to a deposit that is closed.
-- Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_book uuid := gen_random_uuid();
  v_live uuid := gen_random_uuid();
  v_single uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_left bigint;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-live@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Links') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 90, current_date + 275, 1000000, 4, v_book, 'Tích luỹ'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_live, v_user, v_goal, 'bank', 'investment',
    current_date - 5, current_date + 360, 2000000, 4, v_live, 'Sổ còn sống'
  );

  -- A link to a live book is unaffected.
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gửi góp', 1000000, v_live);

  -- ── A book whose ANCHOR tranche is empty is still a live book ─────────────
  --
  -- A link names the anchor but funds the group. A partial withdrawal can empty
  -- that one tranche — by rounding, or taken against it directly — and the book
  -- carries on. Reading the anchor alone would refuse a fundable book.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_user, v_goal, 'bank', 'investment',
    current_date - 20, current_date + 275, 9000000, 4, v_book
  );
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_book,
    current_date, 1010000, 1000000
  );
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_user, v_goal, 'Gửi góp vào sổ còn sống', 1000000, v_book);
  delete from public.recurring_savings where name = 'Gửi góp vào sổ còn sống';

  -- ── ...and a book settled whole is not ────────────────────────────────────
  select coalesce(sum(
           t.amount_vnd - coalesce((
             select sum(w.principal_withdrawn) from public.investment_transactions w
              where w.parent_transaction_id = t.transaction_id
                and w.transaction_type = 'withdrawal'), 0)
         ), 0)
    into v_left
    from public.investment_transactions t
   where t.deposit_group_id = v_book and t.transaction_type = 'investment';
  perform public.withdraw_accumulating_book(v_book, v_left, v_left + 100000, current_date, true);

  begin
    insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
      values (v_user, v_goal, 'Gửi góp vào sổ đã đóng', 1000000, v_book);
    raise exception 'a link to a closed book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ...including by re-pointing a link that is currently valid.
  begin
    update public.recurring_savings set linked_deposit_tx_id = v_book where saving_id = v_saving;
    raise exception 'a link must not be re-pointed at a closed book';
  exception when sqlstate '23514' then null;
  end;

  -- ── A single term deposit, closed, is refused the same way ────────────────
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    v_single, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 165, 4000000, 5, 'Sổ kỳ hạn'
  );
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_single);
  delete from public.recurring_savings where name = 'Gộp khi đáo hạn';

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_single,
    current_date, 4100000, 4000000
  );
  begin
    insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
      values (v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_single);
    raise exception 'a link to a closed term deposit must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'recurring_link_live_deposit: all assertions passed';
end $$;

-- ─── The other way into the same invalid state: closing the deposit ──────────
--
-- Refusing the link only guards the write that CREATES it. A link made while the
-- deposit was alive turns invalid the moment the deposit is emptied, and the
-- ordinary withdrawal path — unlike withdraw_accumulating_book and unlike the
-- held-for-merge settlement, both of which already unlink — left it pointing at
-- a dead target. Same broken state, reached from the other side.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_single uuid := gen_random_uuid();
  v_book uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_book_saving uuid := gen_random_uuid();
  v_link uuid;
  v_mark timestamptz;
  v_from_book boolean;
  v_reason text;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-close@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Đóng sổ') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, notes
  ) values (
    v_single, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 165, 4000000, 5, 'Sổ kỳ hạn'
  );
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_single);

  -- A PARTIAL withdrawal leaves the link alone — the deposit still funds it, so
  -- the assertion below is about closure and not about withdrawals in general.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_user, v_goal, 'bank', 'withdrawal', v_single, current_date, 1010000, 1000000);

  select linked_deposit_tx_id, unlinked_at into v_link, v_mark
    from public.recurring_savings where saving_id = v_saving;
  if v_link is null then raise exception 'a partial withdrawal must not unlink the saving'; end if;
  if v_mark is not null then raise exception 'a partial withdrawal must not mark the saving unlinked'; end if;

  -- The rest of the principal: now it feeds nothing, and must say so.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_user, v_goal, 'bank', 'withdrawal', v_single, current_date, 3050000, 3000000);

  select linked_deposit_tx_id, unlinked_at, unlinked_from_book, unlinked_reason
    into v_link, v_mark, v_from_book, v_reason
    from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then raise exception 'closing the deposit must clear the link'; end if;
  if v_mark is null then raise exception 'closing the deposit must mark the saving unlinked'; end if;
  if v_from_book is not false then raise exception 'a term deposit is not a book'; end if;
  -- The deposit is still on the ledger. Reusing the deletion mark without saying
  -- which is which had the plan announce a deletion that never happened.
  if v_reason is distinct from 'closed' then
    raise exception 'a withdrawn deposit must not be reported as deleted: read %', v_reason;
  end if;

  -- ── A book: the link names the anchor, the withdrawals name the tranches ───
  --
  -- Emptying one tranche is not closing the book, and the saving still has
  -- somewhere to go.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 90, current_date + 275, 1000000, 4, v_book, 'Tích luỹ'
  );
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_user, v_goal, 'bank', 'investment',
    current_date - 20, current_date + 275, 2000000, 4, v_book
  );
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_book_saving, v_user, v_goal, 'Gửi góp', 1000000, v_book);

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_user, v_goal, 'bank', 'withdrawal', v_book, current_date, 1010000, 1000000);

  select linked_deposit_tx_id into v_link
    from public.recurring_savings where saving_id = v_book_saving;
  if v_link is null then raise exception 'emptying one tranche must not unlink a live book'; end if;

  raise notice 'recurring_link_live_deposit close: all assertions passed';
end $$;

-- ─── Links that already point at a closed deposit ────────────────────────────
--
-- The trigger above only fires on writes made from now on. A deployment that
-- already carries the invalid state — the very state this migration says was
-- accepted until today — never writes to those rows again, so nothing would ever
-- notice. The repair is a function rather than loose DML in the migration so it
-- can be exercised here against a state that is otherwise unreachable.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_single uuid := gen_random_uuid();
  v_live uuid := gen_random_uuid();
  v_dead_saving uuid := gen_random_uuid();
  v_live_saving uuid := gen_random_uuid();
  v_link uuid;
  v_mark timestamptz;
  v_reason text;
  v_from_book boolean;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-repair@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Cũ') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_single, v_user, v_goal, 'bank', 'investment', current_date - 200, current_date + 165, 4000000, 5);
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_live, v_user, v_goal, 'bank', 'investment', current_date - 10, current_date + 355, 5000000, 5);

  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_dead_saving, v_user, v_goal, 'Trỏ vào sổ đã đóng', 1000000, v_single);
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_live_saving, v_user, v_goal, 'Trỏ vào sổ còn sống', 1000000, v_live);

  -- Fabricate the legacy row: close the deposit with the new unlinker switched
  -- off, which is exactly how these rows came to exist.
  -- (ALTER TABLE ... DISABLE TRIGGER cannot run here — the inserts above leave
  -- pending trigger events. session_replication_role is the same idea without
  -- touching the table definition, and is closer to the truth anyway: these rows
  -- were written when no such trigger existed at all.)
  set local session_replication_role = replica;
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_user, v_goal, 'bank', 'withdrawal', v_single, current_date, 4100000, 4000000);
  set local session_replication_role = origin;

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_dead_saving;
  if v_link is null then raise exception 'the legacy state was not reproduced, so the repair proves nothing'; end if;

  perform public.repair_closed_recurring_links();

  select linked_deposit_tx_id, unlinked_at, unlinked_reason, unlinked_from_book
    into v_link, v_mark, v_reason, v_from_book
    from public.recurring_savings where saving_id = v_dead_saving;
  if v_link is not null then raise exception 'the repair must clear a link to a closed deposit'; end if;
  if v_mark is null then raise exception 'the repair must mark the saving unlinked'; end if;
  if v_reason is distinct from 'closed' then
    raise exception 'the repair must not report a withdrawn deposit as deleted: read %', v_reason;
  end if;
  -- Not false. This one IS a plain term deposit, but the rows this repair exists
  -- for are closed books whose group was cleared long ago, and the two are the
  -- same row by now. Recording false would tell a book's owner that nothing about
  -- their monthly money changed.
  if v_from_book is not null then
    raise exception 'the repair must not claim to know the kind: read %', v_from_book;
  end if;

  select linked_deposit_tx_id, unlinked_at into v_link, v_mark
    from public.recurring_savings where saving_id = v_live_saving;
  if v_link is null then raise exception 'the repair must leave a link to a live deposit alone'; end if;
  if v_mark is not null then raise exception 'the repair must not mark a saving that still has a target'; end if;

  raise notice 'recurring_link_live_deposit repair: all assertions passed';
end $$;

-- ─── A fund sale is not a withdrawal from the deposit it names ───────────────
--
-- A withdrawal keyed by a fund draws on that (goal, fund) bucket; the parent it
-- names is ignored, which is the precedence check_withdrawal_balance applies
-- (#606). The POST route accepts the shape and older rows carry it. Charged to
-- the deposit instead, a big enough sale makes a live deposit read as closed —
-- and then the unlinker cuts a good link and the guard refuses a good one.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_fund uuid;
  v_dep uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_link uuid;
  v_left bigint;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-fundkey@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Quỹ và sổ') returning goal_id into v_goal;
  insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'Quỹ', 'LNK', 'equity', 50000) returning id into v_fund;

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, fund_id, units, unit_price
  ) values (v_user, v_goal, 'fund', 'investment', current_date - 30, 5000000, v_fund, 100, 50000);

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_dep, v_user, v_goal, 'bank', 'investment', current_date - 30, current_date + 300, 4000000, 5);

  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_dep);

  -- A fund sale larger than the deposit, naming the deposit as its parent.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    amount_vnd, fund_id, units_withdrawn, principal_withdrawn, parent_transaction_id
  ) values (v_user, v_goal, 'fund', 'withdrawal', current_date, 5100000, v_fund, 100, 5000000, v_dep);

  v_left := public.deposit_link_fundable_principal(v_dep);
  if v_left <> 4000000 then
    raise exception 'a fund sale must not be charged to the deposit it names: read %', v_left;
  end if;

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is null then raise exception 'a fund sale must not unlink a live deposit'; end if;

  raise notice 'recurring_link_live_deposit fund key: all assertions passed';
end $$;

-- ─── Closing a deposit without writing a withdrawal ──────────────────────────
--
-- amount_vnd can be edited down to exactly what has already been withdrawn — the
-- balance invariant permits equality — and nothing about the withdrawal changes,
-- so a trigger watching only withdrawals never fires while the deposit is just
-- as closed.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_dep uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_link uuid;
  v_mark timestamptz;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-shrink@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Sửa gốc') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_dep, v_user, v_goal, 'bank', 'investment', current_date - 30, current_date + 300, 4000000, 5);
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_dep);

  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_user, v_goal, 'bank', 'withdrawal', v_dep, current_date, 3050000, 3000000);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is null then raise exception 'a partial withdrawal must not unlink the saving'; end if;

  -- The deposit was never 4,000,000 — correct it down to what is left over.
  update public.investment_transactions set amount_vnd = 3000000 where transaction_id = v_dep;

  select linked_deposit_tx_id, unlinked_at into v_link, v_mark
    from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then raise exception 'shrinking the deposit to nothing must clear the link'; end if;
  if v_mark is null then raise exception 'shrinking the deposit to nothing must mark the saving'; end if;

  raise notice 'recurring_link_live_deposit shrink: all assertions passed';
end $$;

-- ─── A row that BECOMES a withdrawal ─────────────────────────────────────────
--
-- A direct writer can stage parent_transaction_id and principal_withdrawn on an
-- investment row — which draws nothing down, so nothing measures it — and then
-- activate it with a one-column update of transaction_type.
-- check_withdrawal_balance names that path in its own trigger comment and watches
-- the column for exactly this reason; the unlinker has to watch it too, or the
-- deposit closes with its link intact.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_dep uuid := gen_random_uuid();
  v_staged uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_link uuid;
  v_reason text;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-activate@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Kích hoạt') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_dep, v_user, v_goal, 'bank', 'investment', current_date - 30, current_date + 300, 4000000, 5);
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_dep);

  -- Staged as an investment: it takes nothing yet.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn
  ) values (v_staged, v_user, v_goal, 'bank', 'investment', v_dep, current_date, 4100000, 4000000);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is null then raise exception 'a staged row must not unlink anything on its own'; end if;

  -- ...and now it is a withdrawal, taking the whole deposit.
  update public.investment_transactions set transaction_type = 'withdrawal'
   where transaction_id = v_staged;

  select linked_deposit_tx_id, unlinked_reason into v_link, v_reason
    from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then raise exception 'activating the withdrawal must clear the link'; end if;
  if v_reason is distinct from 'closed' then raise exception 'the mark must say closed, read %', v_reason; end if;

  raise notice 'recurring_link_live_deposit activation: all assertions passed';
end $$;

-- ─── ...and the linked row itself stops being a deposit ──────────────────────
--
-- A direct writer can reclassify the very row a saving is linked to: give it a
-- parent and a principal, then call it a withdrawal. The balance invariants
-- accept that (it is measured against its new parent), but the saving is left
-- pointing at a row that is not an investment at all — a link the guard would
-- refuse outright if it were being written now. The unlinker looked only at the
-- parent named by the new withdrawal, never at the reclassified row's own id.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_host uuid := gen_random_uuid();
  v_dep uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_link uuid;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-reclassify@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Đổi loại') returning goal_id into v_goal;

  -- A big live deposit for the reclassified row to draw on...
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_host, v_user, v_goal, 'bank', 'investment', current_date - 60, current_date + 300, 9000000, 5);

  -- ...and the deposit the saving is linked to.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_dep, v_user, v_goal, 'bank', 'investment', current_date - 30, current_date + 300, 4000000, 5);
  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_dep);

  update public.investment_transactions
     set transaction_type = 'withdrawal',
         parent_transaction_id = v_host,
         principal_withdrawn = 4000000
   where transaction_id = v_dep;

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then
    raise exception 'a link must not survive its target ceasing to be a deposit';
  end if;

  raise notice 'recurring_link_live_deposit reclassify: all assertions passed';
end $$;

-- ─── A renewal snapshot is history, not a deposit to fund ───────────────────
--
-- Renewing a term deposit leaves a copy of the cycle that ended, carrying
-- renewed_from_transaction_id. Every reader treats those as history — the
-- active_investment_transactions view, the book measurement here, the goal
-- detail's holding rows — but the single-deposit branch read the snapshot's own
-- amount_vnd as fundable principal, so a link to a closed past cycle was accepted
-- by both the validator and the trigger. The ids are handed out: the
-- investment-transactions response returns them under include_history.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_live uuid := gen_random_uuid();
  v_snapshot uuid := gen_random_uuid();
  v_left bigint;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-renewed@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Đáo hạn') returning goal_id into v_goal;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_live, v_user, v_goal, 'bank', 'investment', current_date - 10, current_date + 355, 4200000, 5);

  -- The cycle it renewed from: same money, already superseded.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, renewed_from_transaction_id
  ) values (v_snapshot, v_user, v_goal, 'bank', 'investment',
            current_date - 375, current_date - 10, 4000000, 5, v_live);

  v_left := public.deposit_link_fundable_principal(v_snapshot);
  if coalesce(v_left, 0) <> 0 then
    raise exception 'a renewal snapshot holds nothing to fund, read %', v_left;
  end if;

  begin
    insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
      values (v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_snapshot);
    raise exception 'a link to a renewal snapshot must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ...while the deposit it renewed into takes the link.
  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_user, v_goal, 'Gộp khi đáo hạn', 1000000, v_live);

  raise notice 'recurring_link_live_deposit renewal snapshot: all assertions passed';
end $$;

-- ─── A handover moves the link; it does not lose it ─────────────────────────
--
-- merge_book_into_successor settles the source book with ORDINARY withdrawals —
-- not held_for_merge, so the unlinker sees them — and then repoints every saving
-- that fed the old book at the new one (#638). Clearing the links when the last
-- tranche empties leaves that repointing update matching nothing, so keeping a
-- planned handover silently unlinked every saving instead of moving it. The
-- money is not leaving here; it is going into the successor, which is exactly
-- what consumed_by_inv_id says.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_source uuid := gen_random_uuid();
  v_successor uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_link uuid;
begin
  insert into auth.users (id, email) values (v_user, 'recurring-link-handover@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Chuyển sổ') returning goal_id into v_goal;

  -- A matured book, and the successor waiting for it.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (v_source, v_user, v_goal, 'bank', 'investment',
            current_date - 400, current_date - 1, 8000000, 4, v_source);
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (v_successor, v_user, v_goal, 'bank', 'investment',
            current_date, current_date + 365, 2000000, 4.5, v_successor);

  insert into public.recurring_savings (saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id)
    values (v_saving, v_user, v_goal, 'Gửi góp', 1000000, v_source);

  perform set_config('app.successor_write', '1', true);
  update public.investment_transactions set successor_deposit_tx_id = v_successor
   where transaction_id = v_source;
  perform set_config('app.successor_write', '', true);

  perform public.merge_book_into_successor(
    v_source, 8100000, 4.5, current_date, array[v_source], array[8000000::bigint], v_successor);

  select linked_deposit_tx_id into v_link from public.recurring_savings where saving_id = v_saving;
  if v_link is distinct from v_successor then
    raise exception 'a handover must move the link to the successor, found %', v_link;
  end if;

  raise notice 'recurring_link_live_deposit handover: all assertions passed';
end $$;

rollback;
