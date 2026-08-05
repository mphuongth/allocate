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
-- So this is one DEFERRED check of the whole book, from whichever row changed.
-- It asks the only question that matters — when this transaction is done, does
-- every tranche still fit its book? — and the RPC's several statements are one
-- transaction. Inserts stay immediate above: there the answer cannot change
-- later in the transaction, and immediate feedback is worth more.
--
-- Deliberately NOT fired by a change to top_up_lock_days: the stored window is
-- an editable snapshot of the bank's policy (#638), and adopting or tightening
-- it on a book that already holds tranches must stay possible. It governs what
-- joins the book from then on.
create or replace function public.assert_accumulating_book_still_fits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_group uuid; v_expiry date; v_lock integer; v_date date; v_days integer;
begin
  v_group := new.deposit_group_id;
  select expiry_date, top_up_lock_days into v_expiry, v_lock
    from public.investment_transactions
   where transaction_id = v_group and deposit_group_id = v_group;
  -- No anchor (the book was dissolved in this transaction) or no maturity: the
  -- policy has nothing to say.
  if not found or v_expiry is null then return null; end if;

  select t.investment_date, v_expiry - t.investment_date
    into v_date, v_days
    from public.investment_transactions t
   where t.deposit_group_id = v_group
     and t.transaction_id <> v_group
     and t.transaction_type = 'investment'
     and v_expiry - t.investment_date <= coalesce(v_lock, 0)
   order by t.investment_date
   limit 1;
  if not found then return null; end if;

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
