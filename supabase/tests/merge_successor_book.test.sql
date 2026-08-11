-- The promise kept: a matured book folded into the successor it was handed to
-- (#638, Phase 3). Run via `npm run test:db` after migrations are applied.
begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_a uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_a3 uuid := gen_random_uuid();
  v_b public.investment_transactions;
  v_saving uuid := gen_random_uuid();
  v_new public.investment_transactions;
  v_ids uuid[];
  v_successor uuid;
  v_linked uuid;
  v_closed bigint;
  v_received bigint := 12500000;
  v_count int;
  v_stamped int;
  v_principals bigint[];
  v_other_goal uuid;
  v_side_goal uuid;
  v_fund uuid;
begin
  insert into auth.users (id, email) values (v_user, 'merge-successor@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Merge') returning goal_id into v_goal;

  -- Book A: two tranches, matured 3 days ago, locked well before that.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate,
    deposit_group_id, top_up_lock_days, notes
  ) values (
    v_a, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date - 3, 8000000, 4, v_a, 30, 'PVcomBank A'
  );
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_a2, v_user, v_goal, 'bank', 'investment',
    current_date - 200, current_date - 3, 4000000, 4.2, v_a
  );

  -- An earlier partial withdrawal on a tranche the merge will fold: the merge
  -- measures around it, and restoring it afterwards would hand back principal
  -- whose payout is by then in the successor.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_a2,
    current_date - 40, 1000000, 1000000, true
  );

  -- A recurring saving still points at A; it must end on B.
  insert into public.recurring_savings (
    saving_id, user_id, goal_id, name, amount_vnd, linked_deposit_tx_id
  ) values (v_saving, v_user, v_goal, 'Monthly', 1000000, v_a);

  -- ── A spent tranche is not the caller's to name ──────────────────────────
  -- The book as the user sees it drops a tranche once its principal is gone, so
  -- demanding its id would make such a book unmergeable however often they
  -- reloaded. v_a3 is fully withdrawn and deliberately left out of v_ids.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id
  ) values (
    v_a3, v_user, v_goal, 'bank', 'investment',
    current_date - 150, current_date - 3, 1000000, 4, v_a
  );
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_a3,
    current_date - 20, 1000000, 1000000, true
  );

  -- The handover A -> B, arranged while A was closing in on maturity.
  select * into v_b from public.open_successor_book(
    v_a, 2000000, 4.5, current_date - 5, current_date + 300, 30, null,
    v_saving, to_char(current_date - 5, 'YYYY-MM'), null);

  v_ids := array[v_a, v_a2];
  v_principals := array[8000000::bigint, 3000000::bigint];

  -- ── A book that is not yet due is not merged early ───────────────────────
  update public.investment_transactions set expiry_date = current_date + 5
   where deposit_group_id = v_a;
  set constraints all immediate;
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'merging a book before its maturity must be refused';
  exception when sqlstate '23514' then null;
  end;
  update public.investment_transactions set expiry_date = current_date - 3
   where deposit_group_id = v_a;
  set constraints all immediate;

  -- ── A tranche the caller never saw aborts the whole thing ────────────────
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, array[v_a], array[8000000::bigint], v_b.transaction_id);
    raise exception 'a book that changed since load must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;

  -- ── A destination the caller never saw ───────────────────────────────────
  -- The promise can be cancelled and re-made while the confirmation sits open,
  -- and the replacement passes every same-goal/same-currency check the pairing
  -- makes. Nothing else here would notice, so the cash would leave for a bank
  -- the user never confirmed. What they saw is named, and has to still be true.
  begin
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date, v_ids, v_principals, gen_random_uuid());
    raise exception 'a merge naming a successor that is no longer linked must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;
  begin
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date, v_ids, v_principals, null);
    raise exception 'a merge naming no successor at all must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;

  -- ── A named tranche that is no longer there ──────────────────────────────
  -- The loop can only notice tranches it walks, so one deleted between the
  -- preview and the lock was simply never met: the merge closed what survived
  -- while crediting the successor with the whole book's payout.
  begin
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date,
      v_ids || gen_random_uuid(), v_principals || 1000000::bigint, v_b.transaction_id);
    raise exception 'a named tranche that no longer exists must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;

  -- ── A payout too small to spread ─────────────────────────────────────────
  -- Each tranche's share is its proportion of the payout, floored. A payout far
  -- below what the book holds floors a share to nothing, and a withdrawal of
  -- zero is not a row this table will take — the merge died on a constraint and
  -- the route answered with a fault, for an amount it had accepted as valid.
  begin
    perform public.merge_book_into_successor(v_a, 1, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a payout too small to reach every tranche must be refused';
  exception when sqlstate '23514' then
    if sqlerrm not like '%merge successor:%' then raise; end if;
  end;

  -- ── Nothing arrives from nowhere ─────────────────────────────────────────
  begin
    perform public.merge_book_into_successor(v_a, 0, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a merge of nothing must be refused';
  exception when sqlstate '23514' then null;
  end;
  begin
    perform public.merge_book_into_successor(v_a, 999000000000, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a received amount unmoored from the book must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- ── A balance that moved since the screen loaded is a changed book ───────
  -- The ids are all still there; only what they hold has changed, which is
  -- exactly the case ids alone cannot see.
  begin
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date, v_ids, array[7000000::bigint, 4000000::bigint], v_b.transaction_id);
    raise exception 'a tranche whose balance moved must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;

  -- ── A submitted tranche that has since been emptied ──────────────────────
  -- Skipping spent tranches before comparing would have hidden this: the others
  -- still match, and the payout bound is loose enough to accept the old figure.
  -- The withdrawal below lands after the caller read the book; the block's own
  -- rollback undoes it once the case has been proved.
  begin
    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
      investment_date, amount_vnd, principal_withdrawn, affects_progress
    ) values (
      v_user, v_goal, 'bank', 'withdrawal', v_a2,
      current_date - 1, 3000000, 3000000, true
    );
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a submitted tranche emptied since the preview must be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%book changed since load%' then raise; end if;
  end;

  -- ── Shapes the merge refuses rather than folds ───────────────────────────
  -- Both are correctable now and not afterwards, once the rows are immutable.
  begin
    update public.investment_transactions set affects_progress = false
     where parent_transaction_id = v_a2 and transaction_type = 'withdrawal';
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a withdrawal kept out of progress must block the merge';
  exception when sqlstate '23514' then null;
  end;
  begin
    insert into public.savings_goals (user_id, goal_name) values (v_user, 'Sideways') returning goal_id into v_side_goal;
    update public.investment_transactions set goal_id = v_side_goal
     where parent_transaction_id = v_a2 and transaction_type = 'withdrawal';
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a withdrawal filed under another goal must block the merge';
  exception when sqlstate '23514' then null;
  end;
  -- A book whose expiries were left split by the old two-statement edit: the
  -- anchor has matured, a tranche has not. Folding it would credit the
  -- successor with cash the bank has not paid out.
  begin
    update public.investment_transactions set expiry_date = current_date + 30
     where transaction_id = v_a2;
    set constraints all immediate;
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a tranche that has not matured must block the merge';
  exception when sqlstate '23514' then null;
  end;
  -- Split the other way: both matured, but this tranche later than the anchor.
  -- Dating the fold to the anchor's maturity would record its withdrawal, and
  -- start the successor's interest, before its cash existed.
  begin
    update public.investment_transactions set expiry_date = current_date - 1
     where transaction_id = v_a2;
    set constraints all immediate;
    perform public.merge_book_into_successor(
      v_a, v_received, 4.5, current_date - 3, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a merge dated before the last tranche matured must be refused';
  exception when sqlstate '23514' then null;
  end;
  update public.investment_transactions set expiry_date = current_date - 3
   where transaction_id = v_a2;
  set constraints all immediate;

  -- A withdrawal re-keyed to a fund is measured against that fund's bucket, not
  -- against the tranche it came out of — while the sum here subtracts it by
  -- parent all the same. The merge would close the apparent remainder and the
  -- rerouted portion would still read as live beside the successor's payout.
  begin
    insert into public.funds (user_id, name, code, fund_type, nav)
    values (v_user, 'Sideways fund', 'SIDEWAYS', 'stock', 10000) returning id into v_fund;
    update public.investment_transactions
       set asset_type = 'fund', fund_id = v_fund
     where parent_transaction_id = v_a2 and transaction_type = 'withdrawal';
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a withdrawal re-keyed to a fund must block the merge';
  exception when sqlstate '23514' then null;
  end;

  -- Renewal lineage hides a withdrawal from every reader while the balance here
  -- still subtracts it: the merge would close what is left and the hidden part
  -- would read as live beside the payout, with the guards refusing to fix it.
  begin
    update public.investment_transactions set renewed_from_transaction_id = v_a
     where parent_transaction_id = v_a2 and transaction_type = 'withdrawal';
    perform public.merge_book_into_successor(v_a, v_received, 4.5, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a withdrawal filed as renewal history must block the merge';
  exception when sqlstate '23514' then null;
  end;

  -- ── The merge itself ─────────────────────────────────────────────────────
  select * into v_new from public.merge_book_into_successor(
    v_a, v_received, 4.6, current_date, v_ids, v_principals, v_b.transaction_id);

  -- Exactly one tranche lands in B, holding the cash that was actually received.
  if v_new.deposit_group_id is distinct from v_b.transaction_id then
    raise exception 'the merged tranche must join the successor book';
  end if;
  if v_new.amount_vnd <> v_received then
    raise exception 'the merged tranche must hold the received cash, found %', v_new.amount_vnd;
  end if;
  if v_new.interest_rate <> 4.6 then
    raise exception 'the merged tranche takes the entered rate';
  end if;
  if v_new.expiry_date is distinct from v_b.expiry_date then
    raise exception 'the merged tranche matures with its new book';
  end if;
  select count(*) into v_count from public.investment_transactions
   where deposit_group_id = v_b.transaction_id and transaction_type = 'investment';
  if v_count <> 2 then  -- B's own anchor + this one
    raise exception 'the merge must add exactly one tranche, found %', v_count;
  end if;

  -- Every tranche of A is closed to the last đồng.
  select sum(t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id and w.transaction_type = 'withdrawal'), 0))
    into v_closed
    from public.investment_transactions t
   where t.deposit_group_id = v_a and t.transaction_type = 'investment';
  if v_closed <> 0 then
    raise exception 'the source book must be fully closed, % left', v_closed;
  end if;

  -- The cash is allocated across the source history without drift, and every
  -- withdrawal says where it went.
  select count(*), coalesce(sum(amount_vnd), 0) into v_stamped, v_closed
    from public.investment_transactions
   where transaction_type = 'withdrawal'
     and consumed_by_inv_id = v_new.transaction_id;
  if v_stamped <> 2 then
    raise exception 'each closed tranche must be stamped, found %', v_stamped;
  end if;
  if v_closed <> v_received then
    raise exception 'the allocated cash must equal what was received, found %', v_closed;
  end if;

  -- The promise has been kept, so it stops standing.
  select successor_deposit_tx_id into v_successor
    from public.investment_transactions where transaction_id = v_a;
  if v_successor is not null then
    raise exception 'a kept promise must not still stand';
  end if;

  -- And nothing is left funding the closed book.
  select linked_deposit_tx_id into v_linked
    from public.recurring_savings where saving_id = v_saving;
  if v_linked is distinct from v_b.transaction_id then
    raise exception 'the recurring link must end on the successor, found %', v_linked;
  end if;

  -- ── Once kept, it cannot be kept again ───────────────────────────────────
  begin
    perform public.merge_book_into_successor(v_a, v_received, 4.6, current_date, v_ids, v_principals, v_b.transaction_id);
    raise exception 'a book with no successor must not be merged';
  exception when sqlstate '23514' or no_data_found then null;
  end;

  -- ── The cash cannot be unpicked from B while it sits there ───────────────
  begin
    delete from public.investment_transactions
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a consumed withdrawal must not be deletable';
  exception when sqlstate '23514' then null;
  end;

  -- Nor can the credited side be rewritten. The withdrawals that paid for this
  -- tranche are frozen and allocate exactly what was received, so raising or
  -- lowering it here invents or destroys money while the source stays closed
  -- for good.
  begin
    update public.investment_transactions set amount_vnd = amount_vnd + 5000000
     where transaction_id = v_new.transaction_id;
    raise exception 'the credited tranche must not be rewritten';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.investment_transactions set affects_progress = false
     where transaction_id = v_new.transaction_id;
    raise exception 'the credited tranche must not be taken out of progress';
  exception when sqlstate '23514' then null;
  end;
  -- The same trick that hides a folded withdrawal hides this: a row with a
  -- renewal parent is history, which valuation skips — the source would stay
  -- closed while the cash it paid out showed up nowhere.
  begin
    update public.investment_transactions set renewed_from_transaction_id = v_b.transaction_id
     where transaction_id = v_new.transaction_id;
    raise exception 'the credited tranche must not be turned into renewal history';
  exception when sqlstate '23514' then null;
  end;
  -- Nor by erasing what says it was credited in the first place.
  begin
    update public.investment_transactions set merged_from_book_id = null
     where transaction_id = v_new.transaction_id;
    raise exception 'the credited tranche must not be able to forget where it came from';
  exception when sqlstate '23514' then null;
  end;

  -- Nor may the lineage be walked up to the book by hand. A collapse moves it
  -- there legitimately, but on its own that move is step one of taking the
  -- payout: with nothing left pointing at the credited tranche, deleting it
  -- stops being refused.
  begin
    update public.investment_transactions set consumed_by_inv_id = v_b.transaction_id
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'the lineage must not be moved to the book outside a collapse';
  exception when sqlstate '23514' then null;
  end;

  -- Nor may a folded withdrawal be detached from the holding it came out of
  -- while that holding still stands: it would stop subtracting, so the source
  -- principal reappears beside the payout the successor now holds. (Either the
  -- withdrawal-balance invariant or this migration's own guard refuses it; what
  -- matters here is that it is refused.)
  begin
    update public.investment_transactions set parent_transaction_id = null
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a folded withdrawal must not be detached from a live holding';
  exception when sqlstate '23514' then null;
  end;

  -- Nor deleted outright. The lineage move that lets a collapse through also
  -- clears the foreign key that used to block this, so on its own the delete
  -- would take the successor's whole payout away while the source stays closed.
  begin
    delete from public.investment_transactions where transaction_id = v_new.transaction_id;
    raise exception 'the credited tranche must not be deletable on its own';
  exception when sqlstate '23514' then null;
  end;

  -- And the freeze must outlive the book it landed in. B's own closure clears
  -- every tranche's deposit_group_id, and while the guard keyed off that shape
  -- the closure handed back an editable row — with the source shut for good.
  update public.investment_transactions set deposit_group_id = null
   where deposit_group_id = v_b.transaction_id;
  set constraints all immediate;
  begin
    update public.investment_transactions set amount_vnd = amount_vnd + 5000000
     where transaction_id = v_new.transaction_id;
    raise exception 'closing the successor book must not unfreeze the credited tranche';
  exception when sqlstate '23514' then null;
  end;

  -- Nor an earlier partial withdrawal beside it: deleting that would restore the
  -- part the merge measured around, to a book whose payout is already elsewhere.
  begin
    delete from public.investment_transactions
     where parent_transaction_id = v_a2 and transaction_type = 'withdrawal'
       and consumed_by_inv_id is null;
    raise exception 'a withdrawal on a folded holding must not be deletable';
  exception when sqlstate '23514' then null;
  end;

  -- Nor rewritten: lowering what a withdrawal took gives the principal back just
  -- as deleting it would, and the balance check does not see it because it
  -- excludes the row being edited.
  begin
    update public.investment_transactions set principal_withdrawn = 1
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a consumed withdrawal must not be rewritten';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.investment_transactions set consumed_by_inv_id = null
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'the lineage stamp must not be cleared';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.investment_transactions set principal_withdrawn = 1
     where parent_transaction_id = v_a2 and consumed_by_inv_id is null;
    raise exception 'an earlier withdrawal on a folded holding must not be rewritten';
  exception when sqlstate '23514' then null;
  end;

  -- Nor reclassified: as an investment the row stops subtracting its principal
  -- from the source while the successor keeps the credit — and it would slip out
  -- of these guards entirely, since they ask for a withdrawal.
  begin
    update public.investment_transactions set transaction_type = 'investment'
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a consumed withdrawal must not be reclassified';
  exception when sqlstate '23514' then null;
  end;

  -- Nor may the goal bar be told to ignore the withdrawal: valuation would still
  -- close the source while progress counted its principal again.
  begin
    update public.investment_transactions set affects_progress = false
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'affects_progress on a folded withdrawal must not be changed';
  exception when sqlstate '23514' then null;
  end;

  -- And the holding itself: once the book is dissolved it looks like an ordinary
  -- deposit to the edit route, and raising its amount passes the solvency check
  -- because the withdrawals against it are smaller than the new amount.
  begin
    update public.investment_transactions set amount_vnd = amount_vnd + 5000000
     where transaction_id = v_a2;
    raise exception 'a folded holding must not be able to grow';
  exception when sqlstate '23514' then null;
  end;

  -- Nor moved to another goal, which would leave its withdrawals behind and let
  -- the new goal show the paid-away principal as live.
  begin
    insert into public.savings_goals (user_id, goal_name) values (v_user, 'Elsewhere') returning goal_id into v_other_goal;
    update public.investment_transactions set goal_id = v_other_goal
     where transaction_id = v_a2;
    raise exception 'a folded holding must not be moved between goals';
  exception when sqlstate '23514' then null;
  end;

  -- The withdrawals cannot be moved out of the goal either: goal detail loads by
  -- raw goal_id, so the source would be shown without the withdrawal that closed
  -- it, and its paid-away principal would read as live.
  begin
    update public.investment_transactions set goal_id = v_other_goal
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a folded withdrawal must not be moved between goals';
  exception when sqlstate '23514' then null;
  end;

  -- A recurring saving cannot be attached to it afterwards either: nothing can
  -- be paid into a deposit whose balance has gone.
  begin
    update public.recurring_savings set linked_deposit_tx_id = v_a2
     where saving_id = v_saving;
    raise exception 'linking to a folded deposit must be refused';
  exception when sqlstate '23514' then null;
  end;

  -- Nor re-keyed to a fund, which would measure it against that fund's bucket
  -- instead of its parent and hand the source principal back.
  begin
    update public.investment_transactions set asset_type = 'fund'
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a folded withdrawal must not be re-keyed to a fund';
  exception when sqlstate '23514' then null;
  end;

  -- Nor marked as a held settlement, which is how the holding-side guard tells
  -- the two apart — flipping it turns that guard off.
  begin
    update public.investment_transactions set held_for_merge = true
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a folded withdrawal must not be relabelled as held';
  exception when sqlstate '23514' then null;
  end;

  -- Nor dressed up as renewal history, which hides the row from the views that
  -- count it and brings the folded principal back that way.
  begin
    update public.investment_transactions set renewed_from_transaction_id = v_b.transaction_id
     where consumed_by_inv_id = v_new.transaction_id;
    raise exception 'a folded withdrawal must not be turned into renewal history';
  exception when sqlstate '23514' then null;
  end;

  -- But deleting the goal must still work: the FK nulls goal_id on all of this,
  -- and a goal that once completed a merge cannot be made undeletable by it.
  delete from public.savings_goals where goal_id = v_other_goal;

  -- ── The settled book stops being a book ──────────────────────────────────
  -- Still self-grouped, it would remain a valid target for a backdated top-up
  -- that resurrects it after its payout has gone.
  select count(*) into v_count from public.investment_transactions
   where deposit_group_id = v_a;
  if v_count <> 0 then
    raise exception 'the settled book must be dissolved, % rows still grouped', v_count;
  end if;

  -- ── Deleting the account takes the whole merge with it ───────────────────
  -- The guards above keep folded history from being unpicked one row at a time;
  -- they must not make an account that ever completed a merge undeletable.
  delete from auth.users where id = v_user;
  select count(*) into v_count from public.investment_transactions where user_id = v_user;
  if v_count <> 0 then
    raise exception 'deleting the account must remove its rows, % left', v_count;
  end if;

  raise notice 'merge successor book: OK';
end;
$$;

-- ── The ordinary re-deposit still folds a sibling in ────────────────────────
--
-- Renewing a deposit stamps the sibling's withdrawal as consumed by it and then
-- rewrites its own amount. That is the same shape as a merge's credited tranche
-- seen from the outside, and freezing both broke it — the smoke lane caught what
-- this suite did not, so the case belongs here.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_d uuid := gen_random_uuid();
  v_s uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_user, 'merge-sibling@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Sibling') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_d, v_user, v_goal, 'bank', 'investment', current_date - 380, current_date - 15, 20000000, 6);
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate
  ) values (v_s, v_user, v_goal, 'bank', 'investment', current_date - 120, current_date + 60, 8000000, 6);

  -- S is settled early and folded into D, exactly as the renewal does it.
  insert into public.investment_transactions (
    user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
    investment_date, amount_vnd, principal_withdrawn, affects_progress, consumed_by_inv_id
  ) values (
    v_user, v_goal, 'bank', 'withdrawal', v_s,
    current_date, 8100000, 8000000, true, v_d
  );

  -- D rolls forward carrying that cash. Nothing here is a book merge, so
  -- nothing here is frozen.
  update public.investment_transactions
     set amount_vnd = 28100000, expiry_date = current_date + 365
   where transaction_id = v_d;

  raise notice 'merge successor book (sibling re-deposit untouched): OK';
end;
$$;

-- ── Deleting the account still works after a merge ──────────────────────────
--
-- The lineage move above runs as a BEFORE DELETE trigger, so it also fires
-- during the cascade from auth.users — where the goal these rows point at may
-- already be gone, and rewriting them fails the ownership check. That made an
-- account that had ever completed a merge undeletable.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_a uuid := gen_random_uuid();
  v_b public.investment_transactions;
  v_count int;
begin
  insert into auth.users (id, email) values (v_user, 'merge-erase@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Erase') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, top_up_lock_days
  ) values (
    v_a, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date - 3, 8000000, 4, v_a, 30
  );
  select * into v_b from public.open_successor_book(
    v_a, 2000000, 4.5, current_date - 5, current_date + 300, 30, null, null, null, null);
  perform public.merge_book_into_successor(
    v_a, 8300000, 4.5, current_date, array[v_a], array[8000000::bigint], v_b.transaction_id);
  set constraints all immediate;

  delete from auth.users where id = v_user;
  select count(*) into v_count from public.investment_transactions where user_id = v_user;
  if v_count <> 0 then
    raise exception 'deleting the account must remove its rows, % left', v_count;
  end if;

  raise notice 'merge successor book (account still deletable): OK';
end;
$$;

-- ── The successor can still be renewed the ordinary way ─────────────────────
--
-- Collapsing a book deletes every non-anchor tranche after snapshotting it. The
-- credited tranche is always one of those, and the source's withdrawals point at
-- it — so without moving that lineage onto the snapshot, the delete hits the
-- foreign key and a successor that ever received a merge can never be renewed
-- again.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_a uuid := gen_random_uuid();
  v_b public.investment_transactions;
  v_new public.investment_transactions;
begin
  insert into auth.users (id, email) values (v_user, 'merge-collapse@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Collapse') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, top_up_lock_days
  ) values (
    v_a, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date - 3, 8000000, 4, v_a, 30
  );
  -- No lock window on B, so its maturity can be brought forward below without
  -- the merged tranche falling inside it.
  select * into v_b from public.open_successor_book(
    v_a, 2000000, 4.5, current_date - 5, current_date + 300, null, null, null, null, null);
  select * into v_new from public.merge_book_into_successor(
    v_a, 8300000, 4.5, current_date - 3, array[v_a], array[8000000::bigint], v_b.transaction_id);
  set constraints all immediate;
  perform set_config('cairn.collapse_b', v_b.transaction_id::text, false);
  perform set_config('cairn.collapse_new', v_new.transaction_id::text, false);
  perform set_config('cairn.collapse_user', v_user::text, false);
end;
$$;

-- B reaches its own maturity.
update public.investment_transactions set expiry_date = current_date
 where deposit_group_id = current_setting('cairn.collapse_b')::uuid;

do $$
declare
  v_b uuid := current_setting('cairn.collapse_b')::uuid;
  v_new uuid := current_setting('cairn.collapse_new')::uuid;
  v_target uuid;
begin
  -- Back to the default mode first: an earlier block in this transaction made
  -- constraints immediate, and that sticks for the whole transaction — which
  -- would fire the deferred freeze below mid-collapse and refuse the collapse's
  -- own write. Nothing outside these tests ever issues SET CONSTRAINTS.
  set constraints all deferred;
  perform public.collapse_accumulating_book(
    v_b, 10600000, 5.0, current_date + 365, current_date,
    array[v_b, v_new], array[100000::bigint, 200000::bigint]);

  -- The lineage moved rather than vanished: the source's withdrawals now name
  -- the book that carried their cash into its new cycle.
  select consumed_by_inv_id into v_target from public.investment_transactions
   where transaction_type = 'withdrawal' and consumed_by_inv_id is not null
     and user_id = current_setting('cairn.collapse_user')::uuid
   limit 1;
  if v_target is null then
    raise exception 'the folded withdrawal must still say where its cash went';
  end if;
  if v_target <> v_b then
    raise exception 'the lineage must follow the tranche up to its book, found %', v_target;
  end if;
  if exists (select 1 from public.investment_transactions where transaction_id = v_new) then
    raise exception 'the collapse must still delete the credited tranche';
  end if;

  -- ...and the deposit it became goes on living. Freezing it because it once
  -- absorbed a merged payout was tried and makes it unrenewable for good: the
  -- renewal rewrites amount_vnd on this very row. Past the collapse the cash is
  -- ordinary principal, under the ordinary rules.
  set constraints all immediate;
  perform public.renew_term_deposit(v_b, 11000000, 5.2, current_date + 400, current_date, 400000);

  raise notice 'merge successor book (successor still collapses): OK';
end;
$$;

-- ── A successor that matured while the source sat unresolved ────────────────
--
-- The merge is dated when the bank paid the source out, and the successor's own
-- door is judged against that date. An overdue book resolved weeks later can
-- therefore be folded into a successor that has itself matured since: the money
-- lands in a book that is already closed, and the recurring savings the merge
-- redirects there have their next contribution refused.
--
-- No write can build this state — the pairing trigger refuses a successor that
-- cannot take a contribution today — so only the calendar moving produces it,
-- and only disabling that trigger reproduces it here.
do $$
declare
  v_user uuid := gen_random_uuid();
  v_goal uuid;
  v_a uuid := gen_random_uuid();
  v_b public.investment_transactions;
begin
  insert into auth.users (id, email) values (v_user, 'merge-late@test.invalid');
  insert into public.savings_goals (user_id, goal_name) values (v_user, 'Late') returning goal_id into v_goal;
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type,
    investment_date, expiry_date, amount_vnd, interest_rate, deposit_group_id, top_up_lock_days
  ) values (
    v_a, v_user, v_goal, 'bank', 'investment',
    current_date - 300, current_date - 3, 8000000, 4, v_a, 30
  );
  -- No lock window on the successor: with one, the same check happens to refuse
  -- this for an unrelated reason, and the hole stays hidden.
  select * into v_b from public.open_successor_book(
    v_a, 2000000, 4.5, current_date - 5, current_date + 300, null, null, null, null, null);
  perform set_config('cairn.test_a', v_a::text, false);
  perform set_config('cairn.test_b', v_b.transaction_id::text, false);
  perform set_config('cairn.test_user', v_user::text, false);
  set constraints all immediate;
end;
$$;

-- The calendar moves past the successor's own maturity.
alter table public.investment_transactions disable trigger investment_transactions_successor_pairing_upd;
update public.investment_transactions set expiry_date = current_date - 1
 where deposit_group_id = current_setting('cairn.test_b')::uuid;
alter table public.investment_transactions enable trigger investment_transactions_successor_pairing_upd;

do $$
declare v_a uuid := current_setting('cairn.test_a')::uuid;
begin
  begin
    perform public.merge_book_into_successor(
      v_a, 8300000, 4.5, current_date - 3, array[v_a], array[8000000::bigint],
      current_setting('cairn.test_b')::uuid);
    raise exception 'a merge into a successor that has itself matured must be refused';
  exception when sqlstate '23514' then null;
  end;
  raise notice 'merge successor book (late resolution): OK';
end;
$$;

rollback;
