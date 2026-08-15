-- A collapse says so itself, instead of being inferred from a snapshot (#652).
--
-- #649 gave two guards a way to recognise a collapse in progress: look for a
-- renewal snapshot written by the CURRENT transaction for this book.
--
--   s.renewed_from_transaction_id = <book> and s.xmin = pg_current_xact_id()::xid
--
-- It reads like a boundary and is a proxy. Both weaknesses were reproduced
-- against a live stack:
--
--   • the evidence is FORGEABLE. renewed_from_transaction_id is an ordinary
--     column, and nothing refuses an authenticated client writing a row that
--     carries it. Forge one for the book and both guards stand aside.
--   • the evidence is TRANSACTION-wide, not statement-wide, so anything sharing
--     a collapse's transaction inherits its licence.
--
-- Neither is reachable through PostgREST, which gives a client one statement per
-- request — so the forgery and the write it licenses cannot land together. That
-- is exactly the shape this schema keeps refusing to rely on: the protection was
-- a property of the API surface, not of the database.
--
-- The instrument is the one 20260811000001 already uses for
-- successor_deposit_tx_id: the function that MAY do the thing marks its own
-- write with a transaction-local flag, and the guards ask for the flag. A client
-- cannot set it — there is no way to run SET through PostgREST, and no function
-- sets this one but the collapse.
--
-- ── the cost, and why it is paid here ────────────────────────────────────────
--
-- collapse_accumulating_book has to be recreated to carry the flag, and it is on
-- the renewal path of every accumulating book. #652 held that trade open rather
-- than settling it inside a review, and the answer is the same one #617 reached
-- for the same instrument:
--
--   • recreating is how this function is edited anyway — 20260618000001,
--     20260618000002 and 20260618000003 are each a full definition of it. This
--     is the fourth, forward-only, and the body below is 20260618000003's
--     unchanged except the two marked lines.
--   • the failure it could cause is not silent. merge_successor_book.test.sql
--     ("successor still collapses") calls this RPC for real against a book whose
--     tranche holds another book's payout — precisely the case the guards fire
--     on — so a future recreation that drops the flag fails the db suite on the
--     PR that does it, rather than breaking a collapse in production.
--
-- The flag is set once, around the tranche loop: the deletes it performs are
-- what the delete guard sees, and the lineage move that guard makes itself is
-- what the edit guard sees. Cleared straight after, so nothing later in the same
-- transaction inherits it — the second weakness above, closed by construction.

create or replace function public.collapse_accumulating_book(
  p_group_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_expiry_date date,
  p_investment_date date,
  p_tranche_ids uuid[],
  p_tranche_interest bigint[],
  p_fulfill_saving_id uuid default null,
  p_fulfill_ym text default null,
  p_fulfill_amount bigint default null,
  p_fulfill_source text default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anchor public.investment_transactions;
  v_tranche public.investment_transactions;
  v_snapshot_id uuid;
  v_interest bigint;
  v_idx int;
  v_renewed public.investment_transactions;
begin
  select * into v_anchor
    from public.investment_transactions
   where transaction_id = p_group_id
     and deposit_group_id = p_group_id
   for update;
  if not found then
    raise exception 'collapse_accumulating_book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_anchor.asset_type is distinct from 'bank' then
    raise exception 'collapse_accumulating_book: only bank books can be collapsed'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'collapse_accumulating_book: amount must be positive'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'collapse_accumulating_book: investment date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  if p_expiry_date is not null and p_expiry_date <= p_investment_date then
    raise exception 'collapse_accumulating_book: new maturity must be after the investment date'
      using errcode = 'check_violation';
  end if;

  -- 0) Preserve EXPLICIT recurring links (#348): re-point any link that targets a
  -- tranche of this book onto the surviving anchor BEFORE the deletes below.
  update public.recurring_savings
     set linked_deposit_tx_id = p_group_id,
         updated_at = now()
   where user_id = v_anchor.user_id
     and linked_deposit_tx_id in (
       select transaction_id from public.investment_transactions
        where deposit_group_id = p_group_id
          and transaction_type = 'investment'
          and renewed_from_transaction_id is null
     );

  -- 1–4) Snapshot, re-parent, then delete every tranche; roll the anchor forward
  -- after the loop.
  --
  -- THE FIRST OF THE TWO CHANGES FROM 20260618000003. The deletes below, and the
  -- lineage move the delete guard makes on their behalf, are refused unless a
  -- collapse says it is doing them (#652). Nothing else sets this flag and no
  -- client can. Dropping this line breaks the collapse of any book holding
  -- another book's payout — pinned by merge_successor_book.test.sql.
  perform set_config('app.collapse_write', '1', true);
  for v_tranche in
    select * from public.investment_transactions
     where deposit_group_id = p_group_id
       and transaction_type = 'investment'
       and renewed_from_transaction_id is null
     order by investment_date
     for update
  loop
    v_idx := array_position(p_tranche_ids, v_tranche.transaction_id);
    -- A live tranche the caller didn't account for ⇒ the book changed since the
    -- route read it (e.g. a top-up landed mid-flight). Abort so its principal is
    -- never silently dropped; the client reloads and retries.
    if v_idx is null then
      -- NB: a plain raise (errcode P0001), NOT serialization_failure (40001) — the
      -- latter is conventionally auto-retried by drivers/poolers, which would spin
      -- on this deterministic abort instead of surfacing it. The route maps this
      -- message to a 409 so the client reloads.
      raise exception 'collapse_accumulating_book: book changed since load, reload and retry';
    end if;
    v_interest := p_tranche_interest[v_idx];

    insert into public.investment_transactions (
      user_id, goal_id, asset_type, transaction_type, amount_vnd,
      investment_date, expiry_date, interest_rate, notes,
      renewed_from_transaction_id, interest_earned_vnd, affects_progress
    ) values (
      v_tranche.user_id, v_tranche.goal_id, 'bank', 'investment', v_tranche.amount_vnd,
      v_tranche.investment_date, v_tranche.expiry_date, v_tranche.interest_rate, v_tranche.notes,
      p_group_id, v_interest, false
    )
    returning transaction_id into v_snapshot_id;

    update public.investment_transactions
       set parent_transaction_id = v_snapshot_id
     where parent_transaction_id = v_tranche.transaction_id
       and transaction_type = 'withdrawal';

    if v_tranche.transaction_id <> p_group_id then
      delete from public.investment_transactions
       where transaction_id = v_tranche.transaction_id;
    end if;
  end loop;
  -- Cleared immediately: the licence covers the loop, not the rest of whatever
  -- transaction this call happens to be in.
  perform set_config('app.collapse_write', '', true);

  update public.investment_transactions
     set amount_vnd        = p_amount_vnd,
         interest_rate     = p_interest_rate,
         expiry_date       = p_expiry_date,
         investment_date   = p_investment_date,
         deposit_group_id  = null,
         updated_at        = now()
   where transaction_id = p_group_id
  returning * into v_renewed;

  if p_fulfill_saving_id is not null and p_fulfill_ym is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_fulfill_saving_id and user_id = v_anchor.user_id
    ) then
      raise exception 'collapse_accumulating_book: recurring saving not found'
        using errcode = 'no_data_found';
    end if;
    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_anchor.user_id, p_fulfill_saving_id, p_fulfill_ym,
      coalesce(p_fulfill_amount, 0), coalesce(p_fulfill_source, 'maturity-collapse')
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();
  end if;

  return v_renewed;
end;
$$;

-- ── the guards ask for the flag ──────────────────────────────────────────────
--
-- Bodies identical to 20260812000001's except the licence test, which was the
-- forged snapshot and is now the collapse's own marker.

create or replace function public.guard_merged_source_withdrawal_edited()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_folded boolean;
begin
  if old.consumed_by_inv_id is not null
     and new.consumed_by_inv_id is distinct from old.consumed_by_inv_id
     -- Unless it is following the tranche it named up to that tranche's own
     -- book, DURING the collapse that is deleting it. Allowing the move on its
     -- own made it step one of taking the payout: with nothing left pointing at
     -- the credited tranche, deleting it stopped being refused.
     --
     -- The licence is the collapse's own marker (#652). It used to be a renewal
     -- snapshot written by this transaction for that book — which reads like
     -- proof and is a forgeable column: an authenticated client can write
     -- renewed_from_transaction_id itself, and nothing refuses it.
     and not (
       coalesce(current_setting('app.collapse_write', true), '') = '1'
       and exists (
         select 1 from public.investment_transactions t
          where t.transaction_id = old.consumed_by_inv_id
            and t.deposit_group_id = new.consumed_by_inv_id
       )
     ) then
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
     and new.amount_vnd is not distinct from old.amount_vnd
     -- ...and only when the holding really is gone. A client can null this
     -- column on a holding that still stands, which is a detachment, not a
     -- cleanup: the withdrawal would stop subtracting from a source that is
     -- still there. The withdrawal-balance invariant (20260730000002) refuses
     -- that on its own today, so this is not a hole — but a guard that leans on
     -- its neighbour's conditions is one narrowing away from being one.
     and not exists (
       select 1 from public.investment_transactions p
        where p.transaction_id = old.parent_transaction_id
     ) then
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

create or replace function public.move_merge_lineage_to_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The account going away takes all of this with it, and the cascade may
  -- already have removed the goal these rows point at — so rewriting them now
  -- fails the ownership check and makes an account that ever completed a merge
  -- undeletable. There is nothing to preserve lineage for either.
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;

  -- Only a collapse in progress, and now it is the collapse that says so (#652).
  -- The old test — a renewal snapshot written by this transaction for this book
  -- — reads like proof of one but is a forgeable column, and it licensed
  -- anything else sharing the transaction. Moving the lineage for any other
  -- delete clears the foreign key that stands in the way and lets an ordinary
  -- DELETE take the successor's whole payout with it, while the source it
  -- emptied stays closed for good.
  if old.deposit_group_id is not null
     and old.deposit_group_id <> old.transaction_id
     and coalesce(current_setting('app.collapse_write', true), '') = '1' then
    update public.investment_transactions
       set consumed_by_inv_id = old.deposit_group_id, updated_at = now()
     where consumed_by_inv_id = old.transaction_id;
    return old;
  end if;

  -- Anything else: refuse while this row still stands for cash another book
  -- paid out. Said here rather than left to the foreign key, which would answer
  -- with a constraint name instead of a reason.
  if exists (
    select 1 from public.investment_transactions w
     where w.consumed_by_inv_id = old.transaction_id
       and w.transaction_type = 'withdrawal'
  ) then
    raise exception 'merge successor: this deposit holds another book''s payout, so it cannot be deleted on its own'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.move_merge_lineage_to_book() from public, anon, authenticated;
