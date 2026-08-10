-- Store a product-specific pre-maturity top-up lock on accumulating books (#638).
alter table public.investment_transactions
  add column if not exists top_up_lock_days integer;

alter table public.investment_transactions
  add constraint investment_transactions_top_up_lock_days_check
  check (top_up_lock_days is null or (top_up_lock_days >= 0 and top_up_lock_days <= 3650));

-- The lock window is deposit terms, so it joins the rest of them in the subtype
-- shape (#593): a fund/gold/stock row may not carry it, and a bank -> gold edit
-- clears it with the others (lib/assetTypeFields.ts nulls the whole exclusive
-- set). Restated in full rather than patched, because a CHECK cannot be altered
-- in place — this is 20260802000001's constraint plus one column.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_subtype_shape;

alter table public.investment_transactions
  add constraint investment_transactions_subtype_shape check (
    transaction_type <> 'investment'
    or asset_type is null
    or case asset_type
         when 'bank' then
           fund_id is null and units is null and unit_price is null
         when 'fund' then
           interest_rate is null and expiry_date is null and bank_code is null
           and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         when 'gold' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         when 'stock' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
           and top_up_lock_days is null
         else true
       end
  );

comment on constraint investment_transactions_subtype_shape on public.investment_transactions is
  'An investment row carries only its own asset type''s fields (#593, #638). See lib/assetTypeFields.ts for the same table in application code.';

create or replace function public.assert_accumulating_book_topup_allowed(p_book_id uuid, p_owner_id uuid, p_top_up_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_anchor public.investment_transactions; v_days_left integer;
begin
  select * into v_anchor from public.investment_transactions
   where transaction_id = p_book_id and deposit_group_id = p_book_id and user_id = p_owner_id for update;
  if not found then raise exception 'accumulating top-up: accumulating book not found' using errcode = 'no_data_found'; end if;
  if v_anchor.expiry_date is null then return; end if;
  v_days_left := v_anchor.expiry_date - p_top_up_date;
  if v_days_left <= 0 then
    raise exception 'accumulating top-up: cannot top up a deposit on or after its maturity date' using errcode = 'check_violation';
  end if;
  if v_anchor.top_up_lock_days is not null and v_days_left <= v_anchor.top_up_lock_days then
    raise exception 'accumulating top-up: this deposit no longer accepts top-ups: % days remain before maturity (its lock window is % days)', v_days_left, v_anchor.top_up_lock_days using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.assert_accumulating_book_topup_allowed(uuid, uuid, date) from public, anon, authenticated;

create or replace function public.enforce_accumulating_book_topup_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.transaction_type = 'investment'
     and new.deposit_group_id is not null
     and new.transaction_id <> new.deposit_group_id
     and (tg_op = 'INSERT'
       or old.deposit_group_id is distinct from new.deposit_group_id
       or old.investment_date is distinct from new.investment_date
       -- A row that BECOMES an investment is a new tranche as far as the book is
       -- concerned. Without this, a booked row could be turned into a withdrawal
       -- (which this trigger skips), redated inside the lock window, and turned
       -- back — the last step changing no other tracked column.
       or old.transaction_type is distinct from new.transaction_type) then
    -- NEW.user_id scopes the SECURITY DEFINER lookup so a book owned by someone
    -- else answers "not found" instead of reporting its maturity and lock window.
    -- But an authenticated caller writes NEW.user_id themselves, and the RLS
    -- WITH CHECK that refuses a foreign owner runs AFTER before-row triggers —
    -- so naming the owner would otherwise buy the same answer. Say nothing about
    -- a row this caller will not own and let RLS refuse it. auth.uid() is null
    -- for the service role and for SQL writers, which still get the backstop.
    if auth.uid() is not null and new.user_id is distinct from auth.uid() then
      return new;
    end if;
    perform public.assert_accumulating_book_topup_allowed(new.deposit_group_id, new.user_id, new.investment_date);
  end if;
  return new;
end;
$$;

-- A new tranche is judged as it arrives: the error points at the insert that
-- caused it, and the FOR UPDATE on the anchor is then held for the rest of the
-- transaction, so two top-ups racing each other are measured one after the other.
drop trigger if exists investment_transactions_accumulating_topup_lock on public.investment_transactions;
create trigger investment_transactions_accumulating_topup_lock
  before insert on public.investment_transactions
  for each row
  execute function public.enforce_accumulating_book_topup_lock();

-- ── Editing an existing book: judged on the final state ─────────────────────
--
-- An UPDATE reaches the same policy from several sides, and one edit can use
-- more than one of them at once:
--
--   • a tranche's date moves into the window, or an ungrouped row joins a book
--     after the cutoff, or a booked row parked as a withdrawal comes back as an
--     investment;
--   • the BOOK's maturity is pulled in around a tranche that was fine before —
--     the extreme being a tranche left dated after its own book's maturity,
--     money in a dead book, which is what the insert guard exists to stop.
--
-- None of these can be judged where they happen. update_deposit_book cascades
-- expiry_date to the whole group in ONE statement and then updates the edited
-- tranche's own date in the NEXT one, so a per-statement check sees the book
-- half-edited: shortening maturity while moving that tranche back out of the
-- window would be refused on the first statement even though the state the
-- caller asked for is perfectly valid.
--
-- So this is one DEFERRED check, from whichever row changed, of the book as the
-- transaction leaves it — and the RPC's several statements are one transaction.
-- Inserts stay immediate above: there the answer cannot change later in the
-- transaction, and immediate feedback is worth more.
--
-- What it asks is whether the EDIT CREATED a breach, not whether the book is
-- spotless. Those differ, because adopting a lock window on a book that already
-- holds tranches is allowed on purpose (see the cascade below: the stored window
-- is an editable snapshot of the bank's policy, and it governs what joins the
-- book from then on). Such a tranche is grandfathered in — and a check that
-- simply scanned the book would then find it during every later edit and refuse
-- unrelated, perfectly valid ones. So:
--
--   • a tranche that changed is judged on its own, and cleared if it was
--     already inside the window before and has not moved further in;
--   • a maturity move is judged against the tranches it pulls INTO the window,
--     not the ones that were already there.
create or replace function public.assert_accumulating_book_still_fits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_expiry date; v_lock integer; v_date date; v_days integer;
begin
  v_group := new.deposit_group_id;

  -- LOCK THE WHOLE BOOK FIRST, then read it in the statements below. Two edits
  -- to different rows of one book would otherwise each measure the other's old
  -- committed value — redating a tranche one day later while the other shortens
  -- maturity by one day, each fine on its own, landing a tranche inside the
  -- window neither transaction ever saw. Locking first makes the second edit
  -- wait and then take a fresh snapshot, which is how the withdrawal balance is
  -- kept atomic (20260730000002). By transaction_id so two books being edited
  -- at once cannot deadlock on each other's rows. Two edits racing INSIDE one
  -- book can still deadlock — each already holds the row it wrote — and Postgres
  -- then aborts one of them, which is the safe answer either way: the book is
  -- never left in a state neither transaction agreed to.
  perform 1 from public.investment_transactions
   where deposit_group_id = v_group
   order by transaction_id
   for update;

  select expiry_date, top_up_lock_days into v_expiry, v_lock
    from public.investment_transactions
   where transaction_id = v_group and deposit_group_id = v_group;
  -- No anchor (the book was dissolved in this transaction) or no maturity: the
  -- policy has nothing to say.
  if not found or v_expiry is null then return null; end if;

  if new.transaction_id = v_group then
    -- The anchor moved the book's maturity. Only tranches this move pulls INTO
    -- the window are its doing; ones already inside it were grandfathered when
    -- the policy was adopted and are not this edit's to refuse.
    select t.investment_date, v_expiry - t.investment_date
      into v_date, v_days
      from public.investment_transactions t
     where t.deposit_group_id = v_group
       and t.transaction_id <> v_group
       and t.transaction_type = 'investment'
       and v_expiry - t.investment_date <= coalesce(v_lock, 0)
       and old.expiry_date - t.investment_date > coalesce(v_lock, 0)
     order by t.investment_date
     limit 1;
    if not found then return null; end if;
  else
    -- One tranche changed. Read it back rather than trusting NEW: a row edited
    -- twice in this transaction queues an event per statement, and only the
    -- table says where it ended up.
    select t.investment_date, v_expiry - t.investment_date
      into v_date, v_days
      from public.investment_transactions t
     where t.transaction_id = new.transaction_id
       and t.deposit_group_id = v_group
       and t.transaction_type = 'investment';
    if not found then return null; end if;                       -- left the book, or is not an investment
    if v_days > coalesce(v_lock, 0) then return null; end if;    -- outside the window: nothing to answer for
    -- Already inside it before this edit, and no deeper in now: grandfathered.
    if old.deposit_group_id = v_group
       and old.transaction_type = 'investment'
       and v_expiry - old.investment_date <= coalesce(v_lock, 0)
       and v_days >= v_expiry - old.investment_date then
      return null;
    end if;
  end if;

  if v_days <= 0 then
    raise exception 'accumulating top-up: this book holds a top-up dated %, at or past its maturity of %', v_date, v_expiry
      using errcode = 'check_violation';
  end if;
  raise exception 'accumulating top-up: this book holds a top-up dated %, inside the % day lock window before its maturity of %', v_date, v_lock, v_expiry
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists investment_transactions_book_maturity_fits_tranches on public.investment_transactions;
drop trigger if exists investment_transactions_book_still_fits on public.investment_transactions;
create constraint trigger investment_transactions_book_still_fits
  after update of deposit_group_id, investment_date, transaction_type, expiry_date
  on public.investment_transactions
  deferrable initially deferred
  for each row
  when (new.deposit_group_id is not null
        and (old.deposit_group_id is distinct from new.deposit_group_id
          or old.investment_date is distinct from new.investment_date
          or old.transaction_type is distinct from new.transaction_type
          or old.expiry_date is distinct from new.expiry_date))
  execute function public.assert_accumulating_book_still_fits();

-- The window is the BOOK's, so it lives on every row of the book, exactly as
-- update_deposit_book cascades maturity, bank and goal. Goal detail reads book
-- terms off whichever group row its page happens to hold — it fetches 200
-- transactions and falls back to a tranche when the anchor is not among them —
-- so a tranche left on the old value would render the book under a policy the
-- database no longer applies, and offer a top-up the anchor then refuses.
--
-- Only the anchor can start this, so the cascade cannot recurse.
create or replace function public.cascade_book_top_up_lock_days()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.investment_transactions
     set top_up_lock_days = new.top_up_lock_days
   where deposit_group_id = new.deposit_group_id
     and transaction_id <> new.transaction_id
     and top_up_lock_days is distinct from new.top_up_lock_days;
  return null;
end;
$$;

drop trigger if exists investment_transactions_book_lock_days_cascade on public.investment_transactions;
create trigger investment_transactions_book_lock_days_cascade
  after update of top_up_lock_days on public.investment_transactions
  for each row
  when (new.deposit_group_id is not null
        and new.transaction_id = new.deposit_group_id
        and old.top_up_lock_days is distinct from new.top_up_lock_days)
  execute function public.cascade_book_top_up_lock_days();
