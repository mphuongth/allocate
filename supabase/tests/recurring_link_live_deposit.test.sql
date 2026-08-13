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

rollback;
