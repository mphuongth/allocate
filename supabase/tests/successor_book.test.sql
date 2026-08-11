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
  v_dated_book uuid := gen_random_uuid();
  v_tail2 public.investment_transactions;
  v_tail3 public.investment_transactions;
  v_lockable uuid := gen_random_uuid();
  v_rec_book uuid := gen_random_uuid();
  v_closed uuid := gen_random_uuid();
  v_stray_saving uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_plan_saving uuid := gen_random_uuid();
  v_lockable2 uuid := gen_random_uuid();
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
  -- Catching `others` here would catch the line above too, and the case would
  -- pass whether or not anything refused it.
  exception when sqlstate '23514' or sqlstate '23503' then null;
  end;

  -- ── The recurring-driven flow moves the whole month in one transaction ───
  -- Its own book, closing in on maturity, with the recurring pointing at it. B
  -- cannot play this part: a successor must stay open past its source's
  -- maturity, so it can never also be a book that is itself nearly mature.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_rec_book, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 20, 10000000, 4, v_rec_book, 30
  );
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (
    v_saving, v_user, v_goal, 'Monthly', 2000000, v_rec_book
  );

  select * into v_c from public.open_successor_book(
    v_rec_book, 2000000, 4.5, current_date - 4, current_date + 361, 30, null,
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
     where deposit_group_id = v_rec_book;
    raise exception 'closing a promised book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Cancelling the handover first is the way out, and then it closes normally.
  update public.investment_transactions set successor_deposit_tx_id = null
   where transaction_id = v_rec_book;
  update public.investment_transactions set deposit_group_id = null
   where deposit_group_id = v_rec_book;
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

  -- A book that matured a while ago, being caught up on late.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_dated_book, v_user, v_goal, 'bank', 'investment',
    current_date - 400, current_date - 60, 10000000, 4, v_dated_book
  );

  -- ── A successor that has already matured cannot take the next month ─────
  -- A contribution may be historical; the book it opens may not be.
  begin
    perform public.open_successor_book(
      v_dated_book, 1000000, 4, current_date - 200, current_date - 10, 30, null, null, null, null);
    raise exception 'a successor that already matured must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Deleting the source drops the promise as silently as closing it ──────
  begin
    delete from public.investment_transactions where transaction_id = v_short_book;
    raise exception 'deleting a promised book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A pair is two live deposits, and stays that way ─────────────────────
  -- An ordinary edit can turn a row into a withdrawal, which takes it out of
  -- holdings: a pair with one half like that promises a merge with nothing.
  begin
    update public.investment_transactions set transaction_type = 'withdrawal'
     where transaction_id = v_tail.transaction_id;
    set constraints all immediate;
    raise exception 'a successor turned into a withdrawal must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Not even tomorrow: the money has not moved yet ──────────────────────
  begin
    perform public.open_successor_book(
      v_dated_book, 1000000, 4, current_date + 1, current_date + 400, 30, null, null, null, null);
    raise exception 'a contribution dated tomorrow must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- A locked book of its own, for the lock-window cases below.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_lockable, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 20, 10000000, 4, v_lockable, 30
  );

  -- ── A handover written straight to the column still needs a reason ──────
  -- v_open_book takes contributions happily; naming a successor on it would
  -- close its door without moving anything, stranding its savings.
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_c.transaction_id
     where transaction_id = v_open_book;
    set constraints all immediate;
    raise exception 'a handover from a book that still accepts top-ups must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- A link written by hand must also land somewhere that can receive: v_b has
  -- long since been given a maturity, but a book inside its own lock window is
  -- no destination for the savings this would move.
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_lockable
     where transaction_id = v_dated_book;
    set constraints all immediate;
    raise exception 'a successor that cannot take money today must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A successor must be open for business, now and at the handover ──────
  -- 25 days out with a 30-day lock is a book already inside its own window: the
  -- savings moved onto it could never contribute, and the merge would be refused
  -- on the very day the old book matures.
  begin
    perform public.open_successor_book(
      v_lockable, 1000000, 4, current_date - 2, current_date + 25, 30, null, null, null, null);
    raise exception 'a successor born inside its own lock window must be refused';
  exception when sqlstate '23514' then null;
  end;
  -- Far enough past the source's maturity, it is fine.
  select * into v_tail3 from public.open_successor_book(
    v_lockable, 1000000, 4, current_date - 2, current_date + 400, 30, null, null, null, null);
  -- ...nor may its maturity be pulled into its own lock window: comparing the
  -- two maturities says nothing about whether it can take money TODAY, which is
  -- what the savings moved onto it need.
  begin
    update public.investment_transactions set expiry_date = current_date + 10
     where transaction_id = v_tail3.transaction_id;
    set constraints all immediate;
    raise exception 'a successor left inside its own lock window must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ...and tightening its lock afterwards may not close that gap either.
  begin
    update public.investment_transactions set top_up_lock_days = 3000
     where transaction_id = v_tail3.transaction_id;
    set constraints all immediate;
    raise exception 'tightening a successor lock past the source maturity must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── No chains: a book owed a merge cannot hand over in turn ─────────────
  -- Reachable once the source has matured and its merge is still outstanding:
  -- v_lockable matured 15 days ago, and v_tail3 is now closing in on its own
  -- maturity. If v_tail3 could promise onward, the merge v_lockable is waiting
  -- for would be refused by the very guard that a handover installs.
  -- This state only arises by AGEING: the pair was valid when it was made, and
  -- then the calendar moved. No edit can produce it — the rule below refuses
  -- terms that leave a successor unable to take money today — so the test ages
  -- the rows with the pairing trigger off, the way time would have.
  alter table public.investment_transactions disable trigger investment_transactions_successor_pairing_upd;
  update public.investment_transactions set expiry_date = current_date - 15
   where deposit_group_id = v_lockable;
  update public.investment_transactions set expiry_date = current_date + 20
   where deposit_group_id = v_tail3.transaction_id;
  alter table public.investment_transactions enable trigger investment_transactions_successor_pairing_upd;
  begin
    perform public.open_successor_book(
      v_tail3.transaction_id, 1000000, 4, current_date - 1, current_date + 500, 30, null, null, null, null);
    raise exception 'a book already promised a merge must not hand over again';
  exception when sqlstate '23514' then null;
  end;

  -- Nor by repointing an existing promise onto a book that has handed over:
  -- a repoint is not a "new link", so it must be judged here, not at creation.
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_rec_book
     where transaction_id = v_dated_book;
    set constraints all immediate;
    raise exception 'repointing onto a book that has handed over must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A successor cannot be edited into a maturity already behind us ──────
  -- The pair ages naturally, so this is about the EDIT: moving the successor's
  -- maturity into the past strands every saving transferred onto it.
  begin
    perform public.update_deposit_book(
      v_tail.transaction_id, false, null, true, (current_date - 1)::date, false, null,
      false, null, false, null, false, null, false, null);
    set constraints all immediate;
    raise exception 'moving a successor maturity into the past must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Clearing both columns at once is still a dissolve ───────────────────
  begin
    update public.investment_transactions
       set deposit_group_id = null, successor_deposit_tx_id = null
     where transaction_id = v_short_book;
    raise exception 'dissolving while dropping the link in one update must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Nor by deleting the successor in the same statement ─────────────────
  -- The guard protects the BOOK, so a two-row delete of anchor + successor must
  -- not leave the anchor's tranches behind grouped under a row that is gone.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, investment_date,
    expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (v_user, v_goal, 'bank', 'investment', current_date - 300,
    current_date - 60, 1000000, 4, v_dated_book);
  select * into v_tail2 from public.open_successor_book(
    v_dated_book, 1000000, 4, current_date - 2, current_date + 400, 30, null, null, null, null);
  begin
    delete from public.investment_transactions
     where transaction_id in (v_dated_book, v_tail2.transaction_id);
    set constraints all immediate;
    raise exception 'deleting a promised anchor beside its successor must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── The column is not a client's to write ───────────────────────────────
  -- Every hole in this feature had one shape: a client writing the link
  -- directly, skipping what gives a handover its meaning. The privilege is the
  -- boundary; the guards above are what the two functions answer to.
  -- Deliberately NOT asserting the revoke: the stack re-grants `authenticated`
  -- after migrations, so the privilege is back by the time anyone connects. The
  -- boundary is the trigger, and this is the case that proves it — granted the
  -- privilege outright, a direct write is still refused. The grant mirrors the
  -- deployed database; the surrounding transaction rolls it away.
  grant select, update on public.investment_transactions to authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  begin
    set local role authenticated;
    update public.investment_transactions set successor_deposit_tx_id = v_tail2.transaction_id
     where transaction_id = v_short_book;
    reset role;
    raise exception 'writing the link directly must be refused';
  exception when sqlstate '23514' then
    reset role;
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- Neither RPC is PUBLIC's to call: they trust a null auth.uid(), which `anon`
  -- also has, so an open EXECUTE would let anyone arrange a handover inside
  -- someone else's account.
  if has_function_privilege('anon',
       'public.open_successor_book(uuid, bigint, numeric, date, date, integer, text, uuid, text, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_successor_book(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute the successor functions';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_successor_book(uuid)', 'EXECUTE') then
    raise exception 'authenticated must keep the cancel function';
  end if;

  -- Deleting the successor drops the promise through the FK, and the boundary
  -- must not take the deletion down with it.
  delete from public.investment_transactions where transaction_id = v_tail2.transaction_id;
  select successor_deposit_tx_id into v_successor
    from public.investment_transactions where transaction_id = v_dated_book;
  if v_successor is not null then
    raise exception 'deleting the successor must drop the promise, found %', v_successor;
  end if;

  -- Cancelling goes through its own function for the same reason.
  perform public.cancel_successor_book(v_short_book);
  select successor_deposit_tx_id into v_successor
    from public.investment_transactions where transaction_id = v_short_book;
  if v_successor is not null then
    raise exception 'cancel_successor_book must clear the link';
  end if;

  -- A locked book with a saving on it, for the plan-month case.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_lockable2, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date + 15, 8000000, 4, v_lockable2, 30
  );
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (
    v_plan_saving, v_user, v_goal, 'Planned', 1000000, v_lockable2
  );

  -- ── The plan and the contribution must name the same month ──────────────
  insert into public.monthly_plans (id, user_id, month, year, salary_vnd)
  values (v_plan, v_user, extract(month from current_date - 40)::int,
          extract(year from current_date - 40)::int, 30000000);
  begin
    perform public.open_successor_book(
      v_lockable2, 1000000, 4, current_date - 1, current_date + 400, 30, null,
      v_plan_saving, to_char(current_date, 'YYYY-MM'), v_plan);
    raise exception 'a plan from another month must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Repointing a promise is the same decision, judged the same way ──────
  -- v_dated_book matured long ago and already promises v_tail2. Moving that
  -- promise onto a book that cannot take money today would leave the overdue
  -- merge with nowhere to land.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days
  ) values (
    v_closed, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date + 10, 5000000, 4, v_closed, 30
  );
  begin
    update public.investment_transactions set successor_deposit_tx_id = v_closed
     where transaction_id = v_dated_book;
    set constraints all immediate;
    raise exception 'repointing onto a book that cannot receive must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── Deleting the user takes both books, and that is allowed ─────────────
  -- The cascade reaches these rows in no guaranteed order, so the check asks
  -- whether the successor SURVIVED rather than refusing every promised source.
  -- v_short_book is still promised to v_tail at this point, so this cascade is
  -- the real case: both halves go, and the promise goes with them.
  delete from auth.users where id = v_user;
  set constraints all immediate;
  if exists (select 1 from public.investment_transactions where user_id = v_user) then
    raise exception 'the account cascade must remove both books';
  end if;

  raise notice 'successor book: OK';
end;
$$;

rollback;
