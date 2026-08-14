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

  select linked_deposit_tx_id, unlinked_at, unlinked_from_book
    into v_link, v_mark, v_from_book
    from public.recurring_savings where saving_id = v_saving;
  if v_link is not null then raise exception 'closing the deposit must clear the link'; end if;
  if v_mark is null then raise exception 'closing the deposit must mark the saving unlinked'; end if;
  if v_from_book is not false then raise exception 'a term deposit is not a book'; end if;

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

  select linked_deposit_tx_id, unlinked_at into v_link, v_mark
    from public.recurring_savings where saving_id = v_dead_saving;
  if v_link is not null then raise exception 'the repair must clear a link to a closed deposit'; end if;
  if v_mark is null then raise exception 'the repair must mark the saving unlinked'; end if;

  select linked_deposit_tx_id, unlinked_at into v_link, v_mark
    from public.recurring_savings where saving_id = v_live_saving;
  if v_link is null then raise exception 'the repair must leave a link to a live deposit alone'; end if;
  if v_mark is not null then raise exception 'the repair must not mark a saving that still has a target'; end if;

  raise notice 'recurring_link_live_deposit repair: all assertions passed';
end $$;

rollback;
