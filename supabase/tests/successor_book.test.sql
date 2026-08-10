-- A locked book hands its contributions to a successor book (#638, Phase 2).
-- Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_goal uuid;
  v_other_goal uuid;
  v_book uuid := gen_random_uuid();
  v_foreign_book uuid := gen_random_uuid();
  v_saving uuid := gen_random_uuid();
  v_b public.investment_transactions;
  v_c public.investment_transactions;
  v_successor uuid;
  v_linked uuid;
  v_fulfilled bigint;
  v_moved_goal uuid;
  v_open_book uuid := gen_random_uuid();
  v_short_book uuid := gen_random_uuid();
  v_tail public.investment_transactions;
  v_extra_saving uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'successor-book@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Successor') returning goal_id into v_goal;

  -- Book A: a 30-day lock and a maturity 24 days out, so it takes no more.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days, bank_code, notes
  ) values (
    v_book, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 24, 10000000, 4,
    v_book, 30, null, 'PVcomBank tích luỹ'
  );

  -- ── The successor carries the book's terms, and the link records it ───────
  select * into v_b from public.open_successor_book(
    v_book, 2000000, 4.2, current_date - 6, current_date + 359, 30, null, null, null, null);

  if v_b.deposit_group_id is distinct from v_b.transaction_id then
    raise exception 'the successor must be an accumulating book anchor';
  end if;
  if v_b.goal_id is distinct from v_goal then raise exception 'the successor must keep the goal'; end if;
  if v_b.amount_vnd <> 2000000 then raise exception 'the successor must hold the contribution'; end if;
  if v_b.expiry_date <> current_date + 359 then raise exception 'the successor takes the entered maturity'; end if;
  if v_b.interest_rate <> 4.2 then raise exception 'the successor takes the entered rate'; end if;
  if v_b.top_up_lock_days is distinct from 30 then raise exception 'the policy carries over as the default'; end if;

  select successor_deposit_tx_id into v_successor
    from public.investment_transactions where transaction_id = v_book;
  if v_successor is distinct from v_b.transaction_id then
    raise exception 'the source book must record its successor';
  end if;

  -- ── One successor per book ────────────────────────────────────────────────
  begin
    perform public.open_successor_book(
      v_book, 1000000, 4, current_date - 5, current_date + 360, 30, null, null, null, null);
    raise exception 'a second successor must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A book cannot succeed itself, nor a book it already succeeds ─────────
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_book
     where transaction_id = v_book;
    raise exception 'a book cannot be its own successor';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.investment_transactions
       set successor_deposit_tx_id = v_book
     where transaction_id = v_b.transaction_id;
    -- The pairing check is deferred so a multi-statement book edit is judged on
    -- its final state; force it here to see the refusal from inside the test.
    set constraints all immediate;
    raise exception 'the successor cannot point back at its source';
  exception when sqlstate '23514' then null;
  end;

  -- ── Only a book may be named, and only one of the caller's own ───────────
  insert into auth.users (id, email) values (v_other, 'successor-book-other@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_other, 'Foreign') returning goal_id into v_other_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_foreign_book, v_other, v_other_goal, 'bank', 'investment',
    current_date - 200, current_date + 150, 10000000, 4, v_foreign_book
  );
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_foreign_book
     where transaction_id = v_b.transaction_id;
    set constraints all immediate;
    raise exception 'a foreign book must not be named as a successor';
  exception when others then null;
  end;

  -- ── The recurring-driven flow moves the whole month in one transaction ───
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (
    v_saving, v_user, v_goal, 'Monthly', 2000000, v_b.transaction_id
  );

  -- Now B is the one closing in on maturity, and the recurring points at it.
  -- Still after A's own maturity: a successor that matured first could never
  -- absorb the book it succeeds.
  update public.investment_transactions set expiry_date = current_date + 25
   where transaction_id = v_b.transaction_id;
  set constraints all immediate;

  select * into v_c from public.open_successor_book(
    v_b.transaction_id, 2000000, 4.5, current_date - 4, current_date + 361, 30, null,
    v_saving, to_char(current_date, 'YYYY-MM'), null);

  select linked_deposit_tx_id into v_linked
    from public.recurring_savings where saving_id = v_saving;
  if v_linked is distinct from v_c.transaction_id then
    raise exception 'the recurring link must move to the successor, found %', v_linked;
  end if;

  select amount_vnd into v_fulfilled
    from public.recurring_saving_fulfillments
   where recurring_saving_id = v_saving and ym = to_char(current_date, 'YYYY-MM');
  if v_fulfilled is distinct from 2000000 then
    raise exception 'the month must be fulfilled by the successor, found %', v_fulfilled;
  end if;

  -- A recurring saving linked to another book cannot be swept along: v_c is a
  -- book of the caller's with no successor yet, and the saving now points at it,
  -- so this fails on the link and not on some earlier guard.
  -- (not at v_book: that one has handed over, and a link there is refused now)
  update public.recurring_savings set linked_deposit_tx_id = null
   where saving_id = v_saving;
  begin
    perform public.open_successor_book(
      v_c.transaction_id, 1000000, 4, current_date - 3, current_date + 362, 30, null,
      v_saving, to_char(current_date + 31, 'YYYY-MM'), null);
    raise exception 'a recurring linked elsewhere must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A book that has handed over takes no more money ──────────────────────
  -- The lock window alone does not cover this: a date before the window still
  -- clears it, and the UI is not the only writer.
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, investment_date,
      expiry_date, amount_vnd, interest_rate, deposit_group_id
    ) values (v_user, v_goal, 'bank', 'investment', current_date - 100,
      current_date + 24, 1000000, 4, v_book);
    raise exception 'a top-up into a handed-over book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── The pairing holds when the SUCCESSOR is the row that moves ───────────
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Elsewhere') returning goal_id into v_moved_goal;
  begin
    perform public.update_deposit_book(
      v_b.transaction_id, true, v_moved_goal, false, null, false, null,
      false, null, false, null, false, null, false, null);
    set constraints all immediate;
    raise exception 'moving the successor to another goal must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A successor is only for a book that has actually closed its doors ────
  -- v_open still takes contributions: nothing about it needs replacing.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_open_book, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 100, 10000000, 4, v_open_book, 30
  );
  begin
    perform public.open_successor_book(
      v_open_book, 1000000, 4, current_date - 5, current_date + 400, 30, null, null, null, null);
    raise exception 'a book that still accepts the contribution must not hand over';
  exception when sqlstate '23514' then null;
  end;

  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_short_book, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 20, 10000000, 4, v_short_book, 30
  );

  -- ── The successor has to outlive the book it takes over from ─────────────
  -- The merge happens at the SOURCE's maturity, so a successor maturing first
  -- is a plan that can never be carried out — refused when it is opened...
  begin
    perform public.open_successor_book(
      v_short_book, 1000000, 4, current_date - 5, current_date + 10, 30, null, null, null, null);
    raise exception 'a successor maturing before its source must be refused';
  exception when sqlstate '23514' then null;
  end;
  -- ...and refused later, when either book's maturity is edited into that shape.
  begin
    perform public.update_deposit_book(
      v_b.transaction_id, false, null, true, (current_date + 500)::date, false, null,
      false, null, false, null, false, null, false, null);
    perform public.update_deposit_book(
      v_book, false, null, true, (current_date + 600)::date, false, null,
      false, null, false, null, false, null, false, null);
    set constraints all immediate;
    raise exception 'pushing the source past its successor must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A book opens with real money, so it needs a rate ─────────────────────
  begin
    perform public.open_successor_book(
      v_short_book, 1000000, null, current_date - 5, current_date + 400, 30, null, null, null, null);
    raise exception 'a successor without a rate must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Nor its rate: the successor holds money and inherits a recurring link ─
  begin
    update public.investment_transactions set interest_rate = null
     where transaction_id = v_c.transaction_id;
    set constraints all immediate;
    raise exception 'clearing the successor rate must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Neither book may lose its maturity while the handover stands ─────────
  begin
    update public.investment_transactions set expiry_date = null
     where transaction_id = v_c.transaction_id;
    set constraints all immediate;
    raise exception 'clearing the successor maturity must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A promised book is not closed behind the promise's back ─────────────
  -- Collapse re-deposits the book's principal into a new cycle: the money has
  -- NOT left, and that is the very moment the handover was made for. Losing the
  -- link there would drop the plan exactly when it comes due.
  begin
    update public.investment_transactions set deposit_group_id = null
     where deposit_group_id = v_b.transaction_id;
    raise exception 'closing a promised book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Cancelling the handover first is the way out, and then it closes normally.
  -- Both ends of it: v_b promises to merge into v_c, and v_book promises to
  -- merge into v_b, so v_b cannot leave until neither promise stands.
  update public.investment_transactions set successor_deposit_tx_id = null
   where transaction_id in (v_b.transaction_id, v_book);
  update public.investment_transactions set deposit_group_id = null
   where deposit_group_id = v_b.transaction_id;
  set constraints all immediate;

  -- ── A successor cannot be withdrawn out from under its source ────────────
  -- A full close clears the successor's own group, which would leave the source
  -- promising to merge into a row that is no longer a book at all.
  -- ── Every saving on the old book follows it, even a manual handover ──────
  -- The source stops accepting contributions the moment the handover commits,
  -- so a saving left pointing at it could never be recorded again.
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (
    v_extra_saving, v_user, v_goal, 'Also here', 500000, v_short_book
  );

  -- v_short_book is still locked and unpromised, so it can open one now.
  select * into v_tail from public.open_successor_book(
    v_short_book, 1000000, 4, current_date - 2, current_date + 400, 30, null, null, null, null);
  select linked_deposit_tx_id into v_linked
    from public.recurring_savings where saving_id = v_extra_saving;
  if v_linked is distinct from v_tail.transaction_id then
    raise exception 'a saving on the old book must follow it, found %', v_linked;
  end if;

  begin
    update public.investment_transactions set deposit_group_id = null
     where transaction_id = v_tail.transaction_id;
    set constraints all immediate;
    raise exception 'dissolving a book that is someone''s successor must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Pledged collateral is frozen, so it cannot be promised away ──────────
  update public.investment_transactions set is_pledged = true
   where transaction_id = v_open_book;
  update public.investment_transactions set expiry_date = current_date + 10
   where deposit_group_id = v_open_book;
  set constraints all immediate;
  begin
    perform public.open_successor_book(
      v_open_book, 1000000, 4, current_date - 2, current_date + 400, 30, null, null, null, null);
    raise exception 'a pledged book must not hand over';
  exception when sqlstate '23514' then null;
  end;

  -- ── A recurring saving cannot be pointed at a book that handed over ──────
  begin
    update public.recurring_savings set linked_deposit_tx_id = v_short_book
     where saving_id = v_extra_saving;
    raise exception 'linking to a handed-over book must be refused';
  exception when sqlstate '23514' then null;
  end;

  raise notice 'successor book: OK';
end;
$$;

rollback;
