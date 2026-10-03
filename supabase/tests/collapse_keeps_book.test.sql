-- Renewing an accumulating book can keep it an accumulating book.
--
-- collapse_accumulating_book always rolled the anchor forward with
-- deposit_group_id = NULL: a matured book came back as a plain term deposit.
-- The recurring saving linked to it kept the link, so the plan page then showed
-- it as "fold in at maturity", "Đã gửi" offered a brand-new deposit instead of a
-- top-up, and each month's contribution became a book of its own. Observed in
-- production on two books renewed 2026-09-03/04, repaired by hand.
--
-- p_keep_book => true keeps the renewed anchor self-grouped, so the next
-- month's recurring top-up lands in it. The default stays false, so callers
-- that do not send it behave exactly as before.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

-- 1) p_keep_book => true: the renewed deposit is still a book, its closed
--    tranches stay out of it, and the linked recurring can top it up.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_tranche   uuid;
  v_saving    uuid;
  v_collapsed public.investment_transactions;
  v_topup     public.investment_transactions;
  v_members   int;
  v_snap_grp  int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-keep@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'NCB', 'NCB')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', 'NCB', 'NCB', v_anchor)
  returning transaction_id into v_tranche;

  insert into public.recurring_savings (user_id, goal_id, name, amount_vnd, effective_from, linked_deposit_tx_id)
  values (v_user, v_goal, 'NCB', 9500000, '2026-03-01', v_anchor)
  returning saving_id into v_saving;

  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 37000000,
    p_interest_rate    => 9.1,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor, v_tranche],
    p_tranche_interest => array[500000::bigint, 500000::bigint],
    p_keep_book        => true
  );

  if v_collapsed.deposit_group_id is distinct from v_anchor then
    raise exception 'a kept book must stay self-grouped, got deposit_group_id %', v_collapsed.deposit_group_id;
  end if;

  select count(*) into v_members from public.investment_transactions where deposit_group_id = v_anchor;
  if v_members <> 1 then
    raise exception 'the renewed book must hold only its new first instalment, got % rows', v_members;
  end if;

  select count(*) into v_snap_grp
    from public.investment_transactions
   where renewed_from_transaction_id = v_anchor and deposit_group_id is not null;
  if v_snap_grp <> 0 then
    raise exception 'closed-cycle snapshots must not join the renewed book, % did', v_snap_grp;
  end if;

  if not exists (select 1 from public.recurring_savings where saving_id = v_saving and linked_deposit_tx_id = v_anchor) then
    raise exception 'the recurring must stay linked to the renewed book';
  end if;

  -- The point of keeping it: next month's "Đã gửi" tops the book up.
  select * into v_topup from public.record_recurring_book_topup(
    p_book_id         => v_anchor,
    p_amount_vnd      => 9500000,
    p_interest_rate   => 4.75,
    p_investment_date => '2026-09-04',
    p_saving_id       => v_saving,
    p_ym              => '2026-09'
  );
  if v_topup.deposit_group_id is distinct from v_anchor then
    raise exception 'the top-up must land in the renewed book';
  end if;
end $$;

-- 2) Omitted p_keep_book: unchanged — the book becomes a plain term deposit.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_collapsed public.investment_transactions;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-default@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'NCB')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 12500000,
    p_interest_rate    => 5.0,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor],
    p_tranche_interest => array[500000::bigint]
  );

  if v_collapsed.deposit_group_id is not null then
    raise exception 'without p_keep_book the collapse must still yield a term deposit, got group %', v_collapsed.deposit_group_id;
  end if;
end $$;

-- 3) The same keep-book collapse under the role the app uses. The ownership and
--    book triggers run as the caller; a guard only a superuser can pass would be
--    a 500 in the app.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_collapsed public.investment_transactions;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-keep-rls@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'NCB')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);
  begin
    set local role authenticated;
    select * into v_collapsed from public.collapse_accumulating_book(
      p_group_id         => v_anchor,
      p_amount_vnd       => 12500000,
      p_interest_rate    => 5.0,
      p_expiry_date      => '2027-03-03',
      p_investment_date  => '2026-09-03',
      p_tranche_ids      => array[v_anchor],
      p_tranche_interest => array[500000::bigint],
      p_keep_book        => true
    );
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  if v_collapsed.deposit_group_id is distinct from v_anchor then
    raise exception 'under RLS a kept book must stay self-grouped, got %', v_collapsed.deposit_group_id;
  end if;

  raise notice 'collapse_keeps_book.test.sql: OK';
end $$;

-- Deferred book triggers (book_still_fits) fire here, inside the transaction.
set constraints all immediate;

rollback;
