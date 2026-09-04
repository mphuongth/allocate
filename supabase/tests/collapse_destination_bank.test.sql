-- Collapsing an accumulating book keeps — and can move — the bank (#640 follow-up).
--
-- Two defects, one root: collapse_accumulating_book was the only cycle-closing
-- path that never learned about bank_code.
--
--   • Its per-tranche snapshot INSERT names its columns explicitly and bank_code
--     was not among them, so every closed cycle lost the bank it sat at. That is
--     silent history loss on its own — and it becomes data loss the moment the
--     collapsed row is deleted, since ON DELETE SET NULL hands those snapshots
--     back as live holdings with no bank at all.
--   • It took no destination bank, so a book could not be re-deposited elsewhere
--     at maturity — the exact gap #640 closed for a lone deposit, still open for
--     a book. The sheet hid its bank picker for books because of this.
--
-- Semantics for p_bank_code mirror renew_term_deposit_with_merge exactly:
-- `bank_code = coalesce(p_bank_code, bank_code)`, so NULL means "leave the book's
-- bank alone" and an empty pick can never wipe one.
--
-- Runs against the local stack in a rolled-back transaction. Run via
-- `npm run test:db`.

begin;

do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_tranche   uuid;
  v_collapsed public.investment_transactions;
  v_banks     text[];
  v_count     int;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-bank@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  -- A two-tranche book at PVCB sharing one maturity.
  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB', 'PVcomBank')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes, deposit_group_id)
  values (v_user, v_goal, 'bank', 'investment', '2026-04-02', 24000000, 4.75, '2026-09-03', 'PVCB', 'PVcomBank', v_anchor)
  returning transaction_id into v_tranche;

  -- 1) Collapse into another bank.
  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 37000000,
    p_interest_rate    => 5.0,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor, v_tranche],
    p_tranche_interest => array[500000::bigint, 400000::bigint],
    p_bank_code        => 'VCB'
  );

  if v_collapsed.bank_code is distinct from 'VCB' then
    raise exception 'expected the collapsed deposit at VCB, got %', v_collapsed.bank_code;
  end if;

  -- 2) Every closed cycle still records where it actually sat. Without this the
  --    history says the money was at no bank, and a later orphaning hands back
  --    bankless holdings.
  select array_agg(bank_code order by investment_date), count(*)
    into v_banks, v_count
    from public.investment_transactions
   where renewed_from_transaction_id = v_anchor;
  if v_count <> 2 then
    raise exception 'expected 2 history snapshots, got %', v_count;
  end if;
  if v_banks is distinct from array['PVCB', 'PVCB'] then
    raise exception 'expected both snapshots to keep bank PVCB, got %', v_banks;
  end if;
end $$;

-- 3) A NULL destination leaves the book's own bank untouched — the shape every
--    caller that does not offer a bank picker sends.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_collapsed public.investment_transactions;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-bank-null@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB')
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

  if v_collapsed.bank_code is distinct from 'PVCB' then
    raise exception 'a null destination must leave the bank alone, got %', v_collapsed.bank_code;
  end if;
end $$;

-- 4) A bank-DERIVED label follows the money. renew_term_deposit_with_merge has
--    relabelled since 20260809000001; collapse applied bank_code and left the
--    notes advertising a bank the money is no longer held at. Observed in
--    production: a five-tranche PVcomBank book collapsed at maturity to NCB kept
--    reading "PVcombank" — the structured field said NCB, every screen said
--    PVcomBank, and the deposit was unrecognisable to its owner.
--
--    The drifted capitalisation is the real one from that incident, so the
--    case-insensitive match is what is being locked in here.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_collapsed public.investment_transactions;
  v_snapshot  text;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-relabel@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB', 'PVcombank')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 12500000,
    p_interest_rate    => 5.0,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor],
    p_tranche_interest => array[500000::bigint],
    p_bank_code        => 'VCB'
  );

  if v_collapsed.notes is distinct from 'Vietcombank' then
    raise exception 'expected the bank-named book relabelled to Vietcombank, got %', v_collapsed.notes;
  end if;

  -- The closed cycle is history: it keeps the name the money was held under.
  select notes into v_snapshot
    from public.investment_transactions
   where renewed_from_transaction_id = v_anchor;
  if v_snapshot is distinct from 'PVcombank' then
    raise exception 'expected the snapshot to keep the old label, got %', v_snapshot;
  end if;
end $$;

-- 5) A name the user typed is theirs. Only a label that reads as some bank's name
--    is bank-derived; "Sổ khẩn cấp" is not, and renaming it would be the worse bug.
do $$
declare
  v_user      uuid;
  v_goal      uuid;
  v_anchor    uuid;
  v_collapsed public.investment_transactions;
begin
  insert into auth.users (id, email) values (gen_random_uuid(), 'collapse-keeps-name@test.invalid') returning id into v_user;
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Emergency') returning goal_id into v_goal;

  insert into public.investment_transactions
    (user_id, goal_id, asset_type, transaction_type, investment_date, amount_vnd, interest_rate, expiry_date, bank_code, notes)
  values (v_user, v_goal, 'bank', 'investment', '2026-03-03', 12000000, 5.8, '2026-09-03', 'PVCB', 'Sổ khẩn cấp')
  returning transaction_id into v_anchor;
  update public.investment_transactions set deposit_group_id = v_anchor where transaction_id = v_anchor;

  select * into v_collapsed from public.collapse_accumulating_book(
    p_group_id         => v_anchor,
    p_amount_vnd       => 12500000,
    p_interest_rate    => 5.0,
    p_expiry_date      => '2027-03-03',
    p_investment_date  => '2026-09-03',
    p_tranche_ids      => array[v_anchor],
    p_tranche_interest => array[500000::bigint],
    p_bank_code        => 'VCB'
  );

  if v_collapsed.notes is distinct from 'Sổ khẩn cấp' then
    raise exception 'a user-typed name must survive the move, got %', v_collapsed.notes;
  end if;
  raise notice 'collapse_destination_bank.test.sql: OK';
end $$;

rollback;
