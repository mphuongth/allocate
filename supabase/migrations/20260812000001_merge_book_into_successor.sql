-- The promise kept: folding a matured book into the successor it was handed to
-- (#638, Phase 3).
--
-- Phase 2 recorded the relationship and steered the contributions. What it could
-- not do was end it: the old book reaches maturity holding real money, and the
-- only thing the app knew how to do with a matured book — collapse it into a
-- fresh cycle — is precisely what the handover said not to do. So a book with a
-- successor had nowhere to go. This is where it goes.
--
-- One function, for the same reason the handover is one: closing the old book,
-- allocating the cash it actually paid out, recording that cash in the new book
-- and retiring the promise are only correct together. Half of it committed is a
-- book closed with its money nowhere, or money in two places at once.

-- Where a credited tranche came from, said outright rather than inferred.
--
-- The guard below has to know "this row holds another book's payout" for as long
-- as that is true, and every shape it could be read off is temporary: the row is
-- a tranche of the successor until the successor itself closes, and its
-- withdrawals look like any other consumption. So the merge records the fact.
--
-- Deliberately not a foreign key. This is history, not a live reference — an FK
-- would null it when the source anchor is deleted, which is exactly the moment
-- the freeze would be handed away. Deleting the account still removes the row
-- itself. (It is also what Phase 4 needs to show "merged from A" on this side.)
alter table public.investment_transactions
  add column if not exists merged_from_book_id uuid;

comment on column public.investment_transactions.merged_from_book_id is
  'The accumulating book whose payout this tranche was credited with (#638, Phase 3). Historical fact, not a live reference.';

-- Same-user only, like every other reference this table carries (#474, #525):
-- a foreign uuid here would name someone else''s book in this one''s history.
drop trigger if exists investment_transactions_merged_from_book_owner on public.investment_transactions;
create trigger investment_transactions_merged_from_book_owner
  before insert or update of merged_from_book_id, user_id on public.investment_transactions
  for each row execute function public.enforce_user_scoped_fk_ownership(
    'merged_from_book_id', 'investment_transactions', 'transaction_id');

-- An earlier draft of this same migration took six arguments. Replacing it would
-- leave both, and PostgREST cannot choose between two overloads — so the shape
-- that no longer exists goes first. (This function has never reached production,
-- so there is nothing here to drop there.)
drop function if exists public.merge_book_into_successor(uuid, bigint, numeric, date, uuid[], bigint[]);

create or replace function public.merge_book_into_successor(
  p_source_book_id uuid,
  p_received_vnd bigint,
  p_interest_rate numeric,
  p_merge_date date,
  p_tranche_ids uuid[],
  p_tranche_principals bigint[],
  -- The destination the caller was looking at when they confirmed. The promise
  -- is cancellable, so between the preview and the press this book can be handed
  -- to a different one — different bank, different terms — and every other check
  -- here would still pass while the cash went somewhere the user never saw.
  p_expected_successor_id uuid
)
returns public.investment_transactions
language plpgsql
-- DEFINER for the same reason as open_successor_book: it has to clear the
-- successor link, which no client may write. RLS therefore scopes nothing here,
-- and every row it touches is checked against the caller explicitly.
security definer
set search_path = ''
as $$
declare
  v_source public.investment_transactions;
  v_dest public.investment_transactions;
  v_tranche public.investment_transactions;
  v_new public.investment_transactions;
  v_new_id uuid := gen_random_uuid();
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_effective bigint;
  v_total bigint := 0;
  v_allocated bigint := 0;
  v_share bigint;
  v_last uuid;
  v_idx int;
begin
  if p_tranche_principals is null
     or array_length(p_tranche_principals, 1) is distinct from array_length(p_tranche_ids, 1) then
    raise exception 'merge successor: every named tranche needs the balance it was seen holding'
      using errcode = 'check_violation';
  end if;
  -- Both books, locked in id order — the same order every other pairing write
  -- takes, so two of them cannot deadlock against each other.
  perform 1 from public.investment_transactions
   where transaction_id in (
     p_source_book_id,
     (select successor_deposit_tx_id from public.investment_transactions
       where transaction_id = p_source_book_id)
   )
   order by transaction_id
   for update;

  select * into v_source from public.investment_transactions
   where transaction_id = p_source_book_id and deposit_group_id = p_source_book_id;
  if not found then
    raise exception 'merge successor: accumulating book not found' using errcode = 'no_data_found';
  end if;
  if auth.uid() is not null and v_source.user_id is distinct from auth.uid() then
    raise exception 'merge successor: accumulating book not found' using errcode = 'no_data_found';
  end if;
  if v_source.successor_deposit_tx_id is null then
    raise exception 'merge successor: this book has no successor to merge into'
      using errcode = 'check_violation';
  end if;
  -- Same wording as a moved balance, and for the same reason: what the caller
  -- confirmed is no longer what the book says. Reloading shows them the book it
  -- is actually promised to now, and they decide again.
  if p_expected_successor_id is distinct from v_source.successor_deposit_tx_id then
    raise exception 'merge successor: book changed since load, reload and retry'
      using errcode = 'raise_exception';
  end if;

  select * into v_dest from public.investment_transactions
   where transaction_id = v_source.successor_deposit_tx_id;
  if not found then
    raise exception 'merge successor: the successor book is gone' using errcode = 'no_data_found';
  end if;

  -- What the pairing invariant has been holding all along is checked once more
  -- here, at the only moment it has to be true for real.
  if v_dest.user_id is distinct from v_source.user_id
     or v_dest.goal_id is distinct from v_source.goal_id
     or coalesce(v_dest.currency, 'VND') is distinct from coalesce(v_source.currency, 'VND')
     or v_dest.deposit_group_id is distinct from v_dest.transaction_id
     or v_dest.transaction_type is distinct from 'investment' then
    raise exception 'merge successor: the successor is no longer a book this one can merge into'
      using errcode = 'check_violation';
  end if;
  if v_source.is_pledged or v_dest.is_pledged then
    raise exception 'merge successor: a pledged deposit cannot be merged while it is collateral'
      using errcode = 'check_violation';
  end if;
  -- Can the successor still take money TODAY? The tranche below is dated when
  -- the bank paid the source out, and the top-up guard judges by that date — so
  -- an overdue book resolved weeks late would fold into a successor that has
  -- itself matured in the meantime, landing the cash in a closed book and
  -- redirecting the recurring savings to one that will refuse them.
  perform public.assert_accumulating_book_topup_allowed(v_dest.transaction_id, v_dest.user_id, v_today);

  -- The merge is what maturity is for, so it does not happen before maturity —
  -- the money has not been paid out yet.
  if v_source.expiry_date is null or v_source.expiry_date > v_today then
    raise exception 'merge successor: this book has not matured yet'
      using errcode = 'check_violation';
  end if;
  if p_merge_date is null or p_merge_date > v_today then
    raise exception 'merge successor: the merge date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_merge_date < v_source.expiry_date then
    raise exception 'merge successor: the cash is paid out at maturity (%), not before', v_source.expiry_date
      using errcode = 'check_violation';
  end if;
  if p_received_vnd is null or p_received_vnd <= 0 then
    raise exception 'merge successor: the received amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_interest_rate is null or p_interest_rate <= 0 then
    raise exception 'merge successor: the new tranche needs its own rate'
      using errcode = 'check_violation';
  end if;

  -- LOCK EVERY TRANCHE BEFORE MEASURING. The balance below decides how much
  -- cash the destination is credited with; read without the lock, a withdrawal
  -- committing between the read and the loop would leave the destination holding
  -- money that withdrawal also took. The withdrawal path takes these same row
  -- locks before it measures (20260730000002), so it waits for us or we for it.
  perform 1 from public.investment_transactions
   where deposit_group_id = p_source_book_id
     and transaction_type = 'investment'
     and renewed_from_transaction_id is null
   order by transaction_id
   for update;

  -- What the book still holds, after any partial withdrawals it has taken.
  select coalesce(sum(t.amount_vnd - coalesce((
           select sum(w.principal_withdrawn) from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id
              and w.transaction_type = 'withdrawal'), 0)), 0)
    into v_total
    from public.investment_transactions t
   where t.deposit_group_id = p_source_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null;
  if v_total <= 0 then
    raise exception 'merge successor: this book is already fully withdrawn'
      using errcode = 'check_violation';
  end if;
  -- ── Shapes this merge cannot represent honestly ─────────────────────────
  -- Both of these are fixable BEFORE the fold and not after, since the rows
  -- become immutable once the cash has moved. So they are refused here, with
  -- the reason, rather than folded into a picture that cannot be corrected.
  --
  -- A withdrawal kept out of progress leaves its principal counted toward the
  -- goal on purpose. Folding around it puts the successor's payout beside a
  -- portion the bar is still counting, and nothing afterwards can reconcile the
  -- two.
  if exists (
    select 1 from public.investment_transactions w
     join public.investment_transactions t on t.transaction_id = w.parent_transaction_id
     where t.deposit_group_id = p_source_book_id
       and t.transaction_type = 'investment'
       and w.transaction_type = 'withdrawal'
       and coalesce(w.affects_progress, true) = false
  ) then
    raise exception 'merge successor: this book has a withdrawal kept out of goal progress; put it back before merging'
      using errcode = 'check_violation';
  end if;
  -- And one sitting in a different goal from the tranche it came out of: goal
  -- detail reads by goal, so that goal would show the tranche and the closing
  -- withdrawal but not this one, and its principal would read as live.
  if exists (
    select 1 from public.investment_transactions w
     join public.investment_transactions t on t.transaction_id = w.parent_transaction_id
     where t.deposit_group_id = p_source_book_id
       and t.transaction_type = 'investment'
       and w.transaction_type = 'withdrawal'
       and w.goal_id is distinct from t.goal_id
  ) then
    raise exception 'merge successor: this book has a withdrawal filed under another goal; move it back before merging'
      using errcode = 'check_violation';
  end if;
  -- And one carrying renewal lineage, which readers treat as history and skip.
  -- The balance below still subtracts it, so the merge would close only what is
  -- left and the hidden portion would read as live beside the successor's
  -- payout — and by then the folded-history guard refuses to correct it.
  if exists (
    select 1 from public.investment_transactions w
     join public.investment_transactions t on t.transaction_id = w.parent_transaction_id
     where t.deposit_group_id = p_source_book_id
       and t.transaction_type = 'investment'
       and w.transaction_type = 'withdrawal'
       and w.renewed_from_transaction_id is not null
  ) then
    raise exception 'merge successor: this book has a withdrawal filed as renewal history; clear its lineage before merging'
      using errcode = 'check_violation';
  end if;

  -- The received cash is the client's number — a settled deposit pays out its
  -- principal plus interest, never a multiple of it. The same bound the renewal
  -- merge applies (20260620000006): loose enough for any real payout, tight
  -- enough that a wrong number cannot inflate the destination out of nothing.
  if p_received_vnd > v_total * 10 then
    raise exception 'merge successor: the received amount is unreasonably large for this book'
      using errcode = 'check_violation';
  end if;

  -- The cash lands in the successor FIRST, because every withdrawal below is
  -- stamped with where it went. The insert passes the same top-up guard any
  -- contribution to that book would — if it has since closed its own door, the
  -- merge stops here rather than closing this book into nothing.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes, bank_code, currency,
    deposit_group_id, top_up_lock_days, affects_progress, merged_from_book_id
  ) values (
    v_new_id, v_dest.user_id, v_dest.goal_id, 'bank', 'investment', p_received_vnd,
    p_merge_date, v_dest.expiry_date, p_interest_rate, v_dest.notes,
    v_dest.bank_code, v_dest.currency, v_dest.transaction_id, v_dest.top_up_lock_days, true,
    p_source_book_id
  )
  returning * into v_new;

  -- Close every live tranche, allocating the received cash across them in
  -- proportion to what each still held. The last one takes whatever rounding
  -- left behind, so the parts add up to the whole exactly.
  -- Among the tranches that still hold something: a spent one is skipped by the
  -- loop, so making it the remainder-taker would drop the rounding on the floor.
  select t.transaction_id into v_last
    from public.investment_transactions t
   where t.deposit_group_id = p_source_book_id
     and t.transaction_type = 'investment'
     and t.renewed_from_transaction_id is null
     and t.amount_vnd - coalesce((
       select sum(w.principal_withdrawn) from public.investment_transactions w
        where w.parent_transaction_id = t.transaction_id
          and w.transaction_type = 'withdrawal'), 0) > 0
   order by t.investment_date desc, t.transaction_id desc
   limit 1;

  for v_tranche in
    select * from public.investment_transactions
     where deposit_group_id = p_source_book_id
       and transaction_type = 'investment'
       and renewed_from_transaction_id is null
     order by investment_date, transaction_id
     for update
  loop
    v_effective := v_tranche.amount_vnd - coalesce((
      select sum(w.principal_withdrawn) from public.investment_transactions w
       where w.parent_transaction_id = v_tranche.transaction_id
         and w.transaction_type = 'withdrawal'), 0);
    -- Membership FIRST, balance second. Skipping spent tranches before the
    -- comparison hid the case where one the caller SUBMITTED has since been
    -- withdrawn to nothing: the rest still matched, the loose payout bound
    -- accepted the old figure, and the successor was credited with cash the
    -- intervening withdrawal had already taken.
    --
    -- So: a tranche the caller named must still hold exactly what they saw, and
    -- one they did not name must hold nothing — the preview omits spent
    -- tranches, which is why demanding their ids would make such a book
    -- unmergeable however often it was reloaded. Plain P0001, not
    -- serialization_failure: this is deterministic, and a pooler must not spin
    -- retrying it.
    v_idx := array_position(p_tranche_ids, v_tranche.transaction_id);
    if v_idx is null then
      if v_effective > 0 then
        raise exception 'merge successor: book changed since load, reload and retry';
      end if;
      continue;
    end if;
    if p_tranche_principals[v_idx] is distinct from v_effective then
      raise exception 'merge successor: book changed since load, reload and retry';
    end if;
    if v_effective <= 0 then continue; end if;

    if v_tranche.transaction_id = v_last then
      v_share := p_received_vnd - v_allocated;
    else
      -- In numeric: a multi-billion payout times a multi-billion balance passes
      -- the bigint ceiling long before the division brings it back down.
      v_share := floor((p_received_vnd::numeric * v_effective) / v_total)::bigint;
      v_allocated := v_allocated + v_share;
    end if;
    -- A payout far below what the book holds floors somebody's share to
    -- nothing, and a withdrawal of zero is not a row this table takes: the
    -- merge died on a raw constraint and the route answered with a fault, for
    -- an amount its own validation had accepted.
    if v_share <= 0 then
      raise exception 'merge successor: the received amount is too small to spread across every tranche of this book'
        using errcode = 'check_violation';
    end if;

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, parent_transaction_id,
      investment_date, amount_vnd, principal_withdrawn, affects_progress,
      consumed_by_inv_id
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'withdrawal', v_tranche.transaction_id,
      p_merge_date, v_share, v_effective, true, v_new_id
    );
  end loop;

  -- Anything still funding the old book now funds the new one — the old one has
  -- nothing left to receive.
  update public.recurring_savings
     set linked_deposit_tx_id = v_dest.transaction_id, updated_at = now()
   where user_id = v_source.user_id
     and linked_deposit_tx_id in (
       select transaction_id from public.investment_transactions
        where deposit_group_id = p_source_book_id
     );

  -- The promise has been kept, so it stops standing. Nothing else may write this
  -- column (20260811000001), which is why this function marks its own write.
  perform set_config('app.successor_write', '1', true);
  update public.investment_transactions
     set successor_deposit_tx_id = null, updated_at = now()
   where transaction_id = p_source_book_id;
  perform set_config('app.successor_write', '', true);

  -- And it stops being a book at all. Settled but still self-grouped, it stays a
  -- valid target for a top-up: a backdated one waiting on the anchor lock would
  -- be accepted the moment this commits — after the tranche set was checked and
  -- every tranche closed — resurrecting a book whose payout already sits in the
  -- successor. The full-withdrawal close path clears the group for the same
  -- reason (20260618000009); one statement, so the whole book leaves together.
  update public.investment_transactions
     set deposit_group_id = null, updated_at = now()
   where deposit_group_id = p_source_book_id;

  return v_new;
end;
$$;

comment on function public.merge_book_into_successor(uuid, bigint, numeric, date, uuid[], bigint[], uuid) is
  'Fold a matured accumulating book into the successor it was handed to, closing it and retiring the promise (#638).';

-- Executable by the people who own books, not by everyone: like the handover
-- functions, this one trusts a null auth.uid() as the service role or SQL, and
-- `anon` has one too.
revoke all on function public.merge_book_into_successor(uuid, bigint, numeric, date, uuid[], bigint[], uuid) from public, anon;
grant execute on function public.merge_book_into_successor(uuid, bigint, numeric, date, uuid[], bigint[], uuid) to authenticated, service_role;


-- Deleting a withdrawal gives its principal back to the holding it came from.
-- That is ordinary — unless the holding has since been folded into another
-- deposit, in which case the principal being restored was paid away and now
-- lives somewhere else. Both halves matter: the withdrawal that DID the folding
-- (deleting it re-opens the whole holding), and any earlier one beside it
-- (deleting that restores the part the merge measured around).
--
-- Immediate, not deferred: a deferred trigger queues an event for every delete
-- it watches, and pending events block ALTER TABLE on this table for the rest of
-- the transaction — which is how the withdrawal-balance suite noticed.
--
-- Being immediate, it also refuses the cascade that would delete a folded
-- holding along with its withdrawals. That is the rule, not a side effect: once
-- a holding's balance has been paid into another deposit, its rows are what say
-- so, and removing them would leave the destination holding cash from nowhere.
create or replace function public.guard_merged_source_withdrawal_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The account going takes everything with it. Being immediate, this guard sees
  -- each row of that cascade individually and would refuse the first folded one,
  -- making any account that ever completed a merge undeletable. The owner's auth
  -- row is already gone by the time the cascade reaches here, which is what
  -- tells the two apart: unpicking history one row at a time is what this
  -- refuses, not removing the account that history belongs to.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  if old.consumed_by_inv_id is not null or exists (
    select 1 from public.investment_transactions w
     where w.parent_transaction_id = old.parent_transaction_id
       and w.transaction_type = 'withdrawal'
       and w.consumed_by_inv_id is not null
  ) then
    raise exception 'merge successor: this holding was folded into another deposit, so its withdrawals cannot be removed'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.guard_merged_source_withdrawal_deleted() from public, anon, authenticated;

drop trigger if exists investment_transactions_merged_withdrawal_kept on public.investment_transactions;
create trigger investment_transactions_merged_withdrawal_kept
  before delete on public.investment_transactions
  for each row
  when (old.transaction_type = 'withdrawal' and old.parent_transaction_id is not null)
  execute function public.guard_merged_source_withdrawal_deleted();


-- Deleting the row is not the only way to give the principal back: an edit that
-- lowers principal_withdrawn does exactly the same, and the balance check does
-- not catch it because it excludes the row being edited. Clearing the stamp is
-- the other half — the lineage is what says the cash moved.
--
-- Stamping an unstamped row is left alone: that is how a merge records where the
-- cash went in the first place.
create or replace function public.guard_merged_source_withdrawal_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_folded boolean;
begin
  if old.consumed_by_inv_id is not null
     and new.consumed_by_inv_id is distinct from old.consumed_by_inv_id then
    raise exception 'merge successor: this withdrawal records where the cash went, so that cannot be unset'
      using errcode = 'check_violation';
  end if;

  -- Reclassifying the row is the quietest way to undo it: as an investment it
  -- stops subtracting its principal from the source, while the successor keeps
  -- the credit — and it slips out of both guards, whose WHEN clauses ask for a
  -- withdrawal, so everything around it becomes editable afterwards too.
  if new.transaction_type is distinct from old.transaction_type
     and (old.consumed_by_inv_id is not null or exists (
       select 1 from public.investment_transactions w
        where w.parent_transaction_id = old.parent_transaction_id
          and w.transaction_type = 'withdrawal'
          and w.consumed_by_inv_id is not null
     )) then
    raise exception 'merge successor: this holding was folded into another deposit, so its withdrawals cannot be reclassified'
      using errcode = 'check_violation';
  end if;

  -- The FK's own cleanup: deleting a holding sets its withdrawals' parent to
  -- null rather than removing them. Nothing is restored by that — the holding
  -- itself is gone — so it is not this guard's business. Re-parenting to a
  -- DIFFERENT holding still is.
  if new.parent_transaction_id is null and old.parent_transaction_id is not null
     and new.principal_withdrawn is not distinct from old.principal_withdrawn
     and new.amount_vnd is not distinct from old.amount_vnd then
    return new;
  end if;

  if new.principal_withdrawn is not distinct from old.principal_withdrawn
     and new.amount_vnd is not distinct from old.amount_vnd
     and new.parent_transaction_id is not distinct from old.parent_transaction_id
     -- What the row claims and from whom: re-keyed to a fund, it is measured
     -- against that fund's bucket instead of its parent, and the source
     -- principal comes back while the successor keeps the payout.
     and new.asset_type is not distinct from old.asset_type
     and new.fund_id is not distinct from old.fund_id
     and new.units_withdrawn is not distinct from old.units_withdrawn
     -- held_for_merge is how the holding-side guard tells a successor merge from
     -- a held settlement. Left editable, flipping it turns that guard off.
     and new.held_for_merge is not distinct from old.held_for_merge
     -- And renewal lineage hides the row outright: the active-transactions view
     -- and the default query both read a row carrying it as history, so the
     -- withdrawal stops counting and the folded principal comes back.
     and new.renewed_from_transaction_id is not distinct from old.renewed_from_transaction_id
     -- affects_progress decides whether the goal bar sees this withdrawal at
     -- all: turned off, valuation still closes the source while progress counts
     -- its principal again, beside the successor that now holds the cash.
     and new.affects_progress is not distinct from old.affects_progress
     -- And moving it to another goal has the same effect by another route: goal
     -- detail loads by raw goal_id, so the source is then shown without the
     -- withdrawal that closed it. Held settlements keep their own rules — and a
     -- goal being DELETED nulls this through the FK, which is not a move and
     -- must not make a goal that once completed a merge undeletable. (The
     -- holding-side guard has carried this carve-out since it was written; this
     -- side went without it.)
     and (new.goal_id is not distinct from old.goal_id
          or coalesce(old.held_for_merge, false)
          or (new.goal_id is null
              and not exists (select 1 from public.savings_goals g where g.goal_id = old.goal_id))) then
    return new;
  end if;

  v_folded := old.consumed_by_inv_id is not null or exists (
    select 1 from public.investment_transactions w
     where w.parent_transaction_id = old.parent_transaction_id
       and w.transaction_type = 'withdrawal'
       and w.consumed_by_inv_id is not null
  );
  if v_folded then
    raise exception 'merge successor: this holding was folded into another deposit, so its withdrawals cannot be rewritten'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_merged_source_withdrawal_edited() from public, anon, authenticated;

drop trigger if exists investment_transactions_merged_withdrawal_immutable on public.investment_transactions;
create trigger investment_transactions_merged_withdrawal_immutable
  before update of principal_withdrawn, amount_vnd, parent_transaction_id,
    consumed_by_inv_id, transaction_type, affects_progress, goal_id,
    asset_type, fund_id, units_withdrawn, held_for_merge, renewed_from_transaction_id
  on public.investment_transactions
  for each row
  when (old.transaction_type = 'withdrawal' and old.parent_transaction_id is not null)
  execute function public.guard_merged_source_withdrawal_edited();


-- The other side of the same coin. Once the merge dissolves the book, each
-- source tranche is an ordinary deposit again as far as the edit route is
-- concerned — and raising its amount_vnd sails past the solvency check, because
-- the withdrawals recorded against it are still smaller than the new amount. The
-- difference then shows up as a live holding while its payout sits in the
-- successor.
--
-- So a holding whose balance was folded away is fixed in every column that says
-- what it is worth or how it counts. Its history is a record of money that has
-- already moved.
create or replace function public.guard_folded_holding_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_vnd is not distinct from old.amount_vnd
     and new.units is not distinct from old.units
     and new.unit_price is not distinct from old.unit_price
     and new.transaction_type is not distinct from old.transaction_type
     and new.affects_progress is not distinct from old.affects_progress
     -- Moving it to another goal splits it from its own withdrawals, which stay
     -- behind: the new goal then sees a holding with nothing recorded against it
     -- and shows the paid-away principal as live.
     --
     -- Only for a book folded by THIS merge. The held-settlement path allows the
     -- same move on purpose (20260731000001, 11c): once its cash is consumed the
     -- pool skips the row, and pinning the goal made any goal that had completed
     -- a merge undeletable. The hazard is arguably shared, but that is a settled
     -- decision with its own tests, and not this migration's to overturn.
     and new.goal_id is not distinct from old.goal_id then
    return new;
  end if;

  -- A goal being deleted nulls this column through the FK, and that is not a
  -- move: nothing is left to move it away from. An unassign, where the goal is
  -- still there, is — it would leave the withdrawals behind in it.
  if new.goal_id is null and old.goal_id is not null
     and new.amount_vnd is not distinct from old.amount_vnd
     and new.units is not distinct from old.units
     and new.unit_price is not distinct from old.unit_price
     and new.transaction_type is not distinct from old.transaction_type
     and new.affects_progress is not distinct from old.affects_progress
     and not exists (select 1 from public.savings_goals g where g.goal_id = old.goal_id) then
    return new;
  end if;

  if exists (
    select 1 from public.investment_transactions w
     where w.parent_transaction_id = old.transaction_id
       and w.transaction_type = 'withdrawal'
       and w.consumed_by_inv_id is not null
       -- A held settlement's own consumption is the other path's business.
       and coalesce(w.held_for_merge, false) = false
  ) then
    raise exception 'merge successor: this deposit was folded into another one, so what it holds cannot be rewritten'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_folded_holding_edited() from public, anon, authenticated;

drop trigger if exists investment_transactions_folded_holding_immutable on public.investment_transactions;
create trigger investment_transactions_folded_holding_immutable
  before update of amount_vnd, units, unit_price, transaction_type, affects_progress, goal_id
  on public.investment_transactions
  for each row
  when (old.transaction_type = 'investment')
  execute function public.guard_folded_holding_edited();

-- (2b) ...and the other side of the same fact. The withdrawals that paid for the
-- credited tranche are frozen and allocate exactly what the bank paid out, but
-- nothing protected the row they point at: the ordinary book edit path could
-- raise or lower it afterwards, inventing or destroying money while the source
-- stayed closed for good. The pair only balances if both sides are held.
create or replace function public.guard_merge_credited_tranche_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.amount_vnd is not distinct from old.amount_vnd
     and new.units is not distinct from old.units
     and new.unit_price is not distinct from old.unit_price
     and new.transaction_type is not distinct from old.transaction_type
     and new.affects_progress is not distinct from old.affects_progress
     -- A row with a renewal parent is history, which valuation skips. Setting
     -- one here empties the successor of this cash without touching a figure.
     and new.renewed_from_transaction_id is not distinct from old.renewed_from_transaction_id
     -- Erasing the marker below would hand the freeze away in one statement.
     and new.merged_from_book_id is not distinct from old.merged_from_book_id then
    return new;
  end if;

  -- The row says so itself. Keying off shape instead — a tranche inside a book —
  -- covered the ordinary re-deposit as well (the smoke lane caught that), and
  -- then stopped covering this row the moment the successor book was closed and
  -- every tranche's group was cleared.
  if old.merged_from_book_id is null then
    return new;
  end if;

  raise exception 'merge successor: another book was folded into this deposit, so what it holds cannot be rewritten'
    using errcode = 'check_violation';
end;
$$;

revoke all on function public.guard_merge_credited_tranche_edited() from public, anon, authenticated;

drop trigger if exists investment_transactions_credited_tranche_immutable on public.investment_transactions;
create trigger investment_transactions_credited_tranche_immutable
  before update of amount_vnd, units, unit_price, transaction_type, affects_progress,
                   renewed_from_transaction_id, merged_from_book_id
  on public.investment_transactions
  for each row
  when (old.merged_from_book_id is not null)
  execute function public.guard_merge_credited_tranche_edited();

-- (3) A recurring link arriving while the merge runs waits on the anchor lock,
-- then re-reads a source whose successor has just been cleared — and accepts,
-- because the promise is gone. The next statement dissolves the book, and the
-- link is left pointing at something no top-up can reach. What the waiter has to
-- see is not the promise but its outcome: this deposit's balance went elsewhere.
-- (Redefined here, so it keeps the revoke the other guard functions carry: a
-- SECURITY DEFINER function has no business being executable by everyone, even
-- one that can only run as a trigger.)
create or replace function public.enforce_recurring_link_not_handed_over()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_successor uuid; v_folded boolean;
begin
  select successor_deposit_tx_id,
         exists (
           select 1 from public.investment_transactions w
            where w.parent_transaction_id = t.transaction_id
              and w.transaction_type = 'withdrawal'
              and w.consumed_by_inv_id is not null
         )
    into v_successor, v_folded
    from public.investment_transactions t
   where t.transaction_id = new.linked_deposit_tx_id
     and t.user_id = new.user_id
   for share;

  if found and v_successor is not null then
    raise exception 'successor book: that book has handed over to a successor, so link the successor instead'
      using errcode = 'check_violation';
  end if;
  if found and v_folded then
    raise exception 'successor book: that deposit has been folded into another one, so link that one instead'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_recurring_link_not_handed_over() from public, anon, authenticated;
