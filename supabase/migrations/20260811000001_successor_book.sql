-- A book that stops accepting contributions hands them to a successor (#638).
--
-- Phase 1 taught the database when a bank refuses another tranche. That leaves
-- the user holding a contribution the bank will not take: the real workflow is
-- to open a NEW accumulating book and send the month there, then fold the old
-- book into it when it matures (Phase 3).
--
-- The relationship is stored, not guessed. Matching two books later by bank,
-- name and date would be a guess, and the whole point of the link is to steer
-- money — the recurring saving's contributions now, the maturity action later.

alter table public.investment_transactions
  add column if not exists successor_deposit_tx_id uuid
  references public.investment_transactions(transaction_id) on delete set null;

-- Only a book anchor may name a successor, and never itself. `on delete set
-- null` above handles a successor that is deleted outright: the plan is dropped
-- and the user is asked to choose again, rather than the source row going with it.
alter table public.investment_transactions
  drop constraint if exists investment_transactions_successor_shape;
alter table public.investment_transactions
  add constraint investment_transactions_successor_shape check (
    successor_deposit_tx_id is null
    -- NULL-safe on purpose: `deposit_group_id = transaction_id` is NULL for a
    -- dissolved row, and a CHECK passes on NULL, so the plain comparison would
    -- let a row keep its successor after it stopped being a book.
    or (deposit_group_id is not distinct from transaction_id
        and successor_deposit_tx_id is distinct from transaction_id)
  );

-- Which makes the dissolve flows the constraint's problem: withdraw_book_close_group
-- and collapse_accumulating_book both clear deposit_group_id across the group.
--
-- Clearing the link along with the book would be wrong, and quietly so. Collapse
-- is what "handle maturity" runs today: it re-deposits the book's principal into
-- a fresh term cycle. The money has NOT left — and that is precisely the moment
-- the handover was made for, the merge into the successor that Phase 3 performs.
-- Dropping the relationship there would lose the plan exactly when it comes due.
--
-- So a promised book is not dissolved by any route: the promise is cancelled
-- first, deliberately, by whoever made it (DELETE on the successor endpoint).
create or replace function public.enforce_successor_before_dissolve()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.successor_deposit_tx_id is not null
     and new.successor_deposit_tx_id is not null
     and new.deposit_group_id is distinct from new.transaction_id then
    raise exception 'successor book: this book is promised to a successor, so cancel the handover before closing it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists investment_transactions_successor_cleared_on_dissolve on public.investment_transactions;
drop trigger if exists investment_transactions_successor_before_dissolve on public.investment_transactions;
create trigger investment_transactions_successor_before_dissolve
  before update of deposit_group_id on public.investment_transactions
  for each row
  when (old.successor_deposit_tx_id is not null)
  execute function public.enforce_successor_before_dissolve();

create unique index if not exists investment_transactions_successor_unique
  on public.investment_transactions (successor_deposit_tx_id)
  where successor_deposit_tx_id is not null;

comment on column public.investment_transactions.successor_deposit_tx_id is
  'The accumulating book this one is planned to be folded into at maturity (#638).';

-- The reference is a user-scoped one like every other (20260728000001).
drop trigger if exists investment_transactions_successor_fk_ownership on public.investment_transactions;
create trigger investment_transactions_successor_fk_ownership
  before insert or update of successor_deposit_tx_id, user_id on public.investment_transactions
  for each row execute function public.enforce_user_scoped_fk_ownership(
    'successor_deposit_tx_id', 'investment_transactions', 'transaction_id');

-- What the link promises is that the two books CAN be merged later, so refuse a
-- pairing that could never be: a successor must itself be a live accumulating
-- book, in the same goal and currency, and it must not already point back at
-- the source (a two-book cycle has no maturity order).
create or replace function public.assert_successor_book_pairing(p_source_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_source public.investment_transactions; v_successor public.investment_transactions;
begin
  select * into v_source from public.investment_transactions where transaction_id = p_source_id;
  if not found or v_source.successor_deposit_tx_id is null then return; end if;

  select * into v_successor from public.investment_transactions
   where transaction_id = v_source.successor_deposit_tx_id and user_id = v_source.user_id;
  -- Ownership is the fk trigger's job; say nothing here about a row that is not
  -- the caller's, so a foreign book cannot be probed through these messages.
  if not found then return; end if;

  if v_successor.deposit_group_id is distinct from v_successor.transaction_id then
    raise exception 'successor book: a successor must itself be an accumulating book'
      using errcode = 'check_violation';
  end if;
  if v_successor.goal_id is distinct from v_source.goal_id then
    raise exception 'successor book: both books must belong to the same goal'
      using errcode = 'check_violation';
  end if;
  if coalesce(v_successor.currency, 'VND') is distinct from coalesce(v_source.currency, 'VND') then
    raise exception 'successor book: both books must be in the same currency'
      using errcode = 'check_violation';
  end if;
  if v_successor.successor_deposit_tx_id = v_source.transaction_id then
    raise exception 'successor book: two books cannot succeed each other'
      using errcode = 'check_violation';
  end if;
  -- The merge happens when the SOURCE matures, so both books need a maturity at
  -- all — the edit route lets one be cleared — and the successor's has to come
  -- after. A successor maturing first is a plan that cannot be carried out.
  if v_source.expiry_date is null or v_successor.expiry_date is null then
    raise exception 'successor book: both books need a maturity while the handover stands'
      using errcode = 'check_violation';
  end if;
  -- The successor holds real money and inherits the recurring link, and a
  -- rateless deposit is not a valid target for one — the edit route can clear a
  -- rate long after the book was opened.
  if v_successor.interest_rate is null or v_successor.interest_rate <= 0 then
    raise exception 'successor book: the successor needs a rate while the handover stands'
      using errcode = 'check_violation';
  end if;
  if v_successor.expiry_date <= v_source.expiry_date then
    raise exception 'successor book: the successor must mature after the book it takes over from (% is not after %)',
      v_successor.expiry_date, v_source.expiry_date
      using errcode = 'check_violation';
  end if;
end;
$$;

-- The pairing can be broken from EITHER end: by re-pointing the source, or by
-- editing the successor out from under it — moving that book to another goal is
-- an ordinary transaction edit, and it would leave the source promising a merge
-- that can never happen. So the check runs from whichever row moved, and looks
-- both ways.
--
-- Deferred, for the reason the top-up guard is (#638): update_deposit_book
-- rewrites a book across several statements, and only the state the transaction
-- ends in is the state the user asked for.
create or replace function public.enforce_successor_book_pairing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform public.assert_successor_book_pairing(new.transaction_id);
  for v_id in
    select transaction_id from public.investment_transactions
     where successor_deposit_tx_id = new.transaction_id
  loop
    perform public.assert_successor_book_pairing(v_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists investment_transactions_successor_pairing on public.investment_transactions;
drop trigger if exists investment_transactions_successor_pairing_ins on public.investment_transactions;
-- Two triggers rather than one, because the UPDATE side has to look at the row's
-- OLD shape as well and OLD is not available to an INSERT trigger's WHEN.
--
-- Both stay narrow: a deferred event is queued until commit, and pending events
-- block ALTER TABLE on this table, so every unrelated edit must not carry one.
create constraint trigger investment_transactions_successor_pairing_ins
  after insert on public.investment_transactions
  deferrable initially deferred
  for each row
  when (new.successor_deposit_tx_id is not null)
  execute function public.enforce_successor_book_pairing();

drop trigger if exists investment_transactions_successor_pairing_upd on public.investment_transactions;
create constraint trigger investment_transactions_successor_pairing_upd
  after update of successor_deposit_tx_id, goal_id, currency, deposit_group_id, expiry_date, interest_rate
  on public.investment_transactions
  deferrable initially deferred
  for each row
  -- A row that names a successor, a book anchor (the only kind that can BE one),
  -- and a row that STOPPED being an anchor: a fully withdrawn successor has its
  -- group cleared, and matching only on the new shape would let it slip away
  -- from a source still promising to merge into it.
  when (new.successor_deposit_tx_id is not null
        or new.deposit_group_id = new.transaction_id
        or old.deposit_group_id = old.transaction_id)
  execute function public.enforce_successor_book_pairing();

-- ── A book that has handed over is closed to new money ──────────────────────
--
-- The lock window does not cover this on its own: a contribution dated before
-- the window still clears it, so a stale modal or a deliberately historical
-- date could keep feeding the old book after its recurring link has moved —
-- splitting one month's saving across two books. The handover is the same kind
-- of fact as maturity, so it belongs in the same guard every writer passes.
create or replace function public.assert_accumulating_book_topup_allowed(p_book_id uuid, p_owner_id uuid, p_top_up_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare v_anchor public.investment_transactions; v_days_left integer;
begin
  select * into v_anchor from public.investment_transactions
   where transaction_id = p_book_id and deposit_group_id = p_book_id and user_id = p_owner_id for update;
  if not found then raise exception 'accumulating top-up: accumulating book not found' using errcode = 'no_data_found'; end if;
  if v_anchor.successor_deposit_tx_id is not null then
    raise exception 'accumulating top-up: this book has handed over to a successor, so contributions belong there'
      using errcode = 'check_violation';
  end if;
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

-- ── Opening the successor ───────────────────────────────────────────────────
--
-- One call, because the recurring-driven flow is four writes that are only
-- correct together: create B, record the month's contribution in it, mark the
-- month fulfilled so the plan does not ask for it twice, and move the recurring
-- link off the book that can no longer receive it. Half of that, committed
-- alone, is a plan that double-counts or a contribution filed nowhere.
--
-- B's opening tranche IS its anchor row: an accumulating book's anchor carries
-- the first contribution, and every later top-up joins the group behind it.
create or replace function public.open_successor_book(
  p_source_book_id uuid,
  p_amount_vnd bigint,
  p_interest_rate numeric,
  p_investment_date date,
  p_expiry_date date,
  p_top_up_lock_days integer,
  p_notes text,
  p_saving_id uuid default null,
  p_ym text default null,
  p_plan_id uuid default null
)
returns public.investment_transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.investment_transactions;
  v_book public.investment_transactions;
  v_new_id uuid := gen_random_uuid();
begin
  select * into v_source
    from public.investment_transactions
   where transaction_id = p_source_book_id
     and deposit_group_id = p_source_book_id
   for update;
  if not found then
    raise exception 'successor book: accumulating book not found'
      using errcode = 'no_data_found';
  end if;
  if v_source.asset_type is distinct from 'bank' then
    raise exception 'successor book: not a bank book' using errcode = 'check_violation';
  end if;
  if v_source.successor_deposit_tx_id is not null then
    raise exception 'successor book: this book already has a successor'
      using errcode = 'check_violation';
  end if;
  if p_amount_vnd is null or p_amount_vnd <= 0 then
    raise exception 'successor book: amount must be positive' using errcode = 'check_violation';
  end if;
  -- A deposit with no rate earns nothing here and is not a valid target for a
  -- recurring link either, and this book opens holding real money.
  if p_interest_rate is null or p_interest_rate <= 0 then
    raise exception 'successor book: the new book needs its own rate' using errcode = 'check_violation';
  end if;
  if p_expiry_date is null or p_investment_date is null or p_expiry_date <= p_investment_date then
    raise exception 'successor book: the new maturity must come after the contribution'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'successor book: contribution date cannot be in the future'
      using errcode = 'check_violation';
  end if;
  -- A successor is the answer to a bank that WILL NOT take the money. If the old
  -- book still accepts this contribution on this date, opening one would retire
  -- a perfectly usable book and move its recurring link for nothing — and the
  -- contribution date is editable in the sheet, so this is reachable from the UI.
  -- The eligibility rule is spelled out rather than delegated: the shared
  -- assertion is deliberately not executable by `authenticated`, and this is a
  -- SECURITY INVOKER function.
  if v_source.expiry_date is null
     or (v_source.expiry_date - p_investment_date > 0
         and (v_source.top_up_lock_days is null
              or v_source.expiry_date - p_investment_date > v_source.top_up_lock_days)) then
    raise exception 'successor book: this book still accepts a contribution dated %, so record it as a top-up', p_investment_date
      using errcode = 'check_violation';
  end if;
  -- Whatever the successor's own terms, it has to outlive the book it takes
  -- over from, since the merge happens when that one matures.
  if v_source.expiry_date is not null and p_expiry_date <= v_source.expiry_date then
    raise exception 'successor book: the new maturity must come after the old book''s (%)', v_source.expiry_date
      using errcode = 'check_violation';
  end if;

  -- The successor inherits what identifies the money — owner, goal, bank,
  -- currency — and takes the terms the user entered for the new book.
  insert into public.investment_transactions (
    transaction_id, user_id, goal_id, asset_type, transaction_type, amount_vnd,
    investment_date, expiry_date, interest_rate, notes, bank_code, currency,
    deposit_group_id, top_up_lock_days, plan_id, affects_progress
  ) values (
    v_new_id, v_source.user_id, v_source.goal_id, 'bank', 'investment', p_amount_vnd,
    p_investment_date, p_expiry_date, p_interest_rate,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), v_source.notes),
    v_source.bank_code, v_source.currency,
    v_new_id, p_top_up_lock_days, p_plan_id, true
  )
  returning * into v_book;

  update public.investment_transactions
     set successor_deposit_tx_id = v_new_id, updated_at = now()
   where transaction_id = p_source_book_id;

  -- EVERY saving pointing at the old book follows it. The source stops accepting
  -- contributions the moment this commits, so a saving left behind would be
  -- funding a book that refuses it — and the monthly plan would have no way to
  -- record the month at all. This runs whichever entry point opened the
  -- successor: the manual one names no saving, and would otherwise strand them.
  --
  -- LOCK them while reading. The book lock says nothing about these rows, so
  -- without it a relink landing between the read and the write would be
  -- silently overwritten.
  perform 1 from public.recurring_savings
   where user_id = v_source.user_id and linked_deposit_tx_id = p_source_book_id
   order by saving_id
   for update;

  -- Recurring-driven: the month is also contributed to B and marked fulfilled.
  -- A saving linked elsewhere is not this flow's to move.
  if p_saving_id is not null then
    if not exists (
      select 1 from public.recurring_savings
       where saving_id = p_saving_id
         and user_id = v_source.user_id
         and linked_deposit_tx_id = p_source_book_id
    ) then
      raise exception 'successor book: that recurring saving is not linked to this book'
        using errcode = 'check_violation';
    end if;
    if p_ym is null then
      raise exception 'successor book: a recurring contribution needs its month'
        using errcode = 'check_violation';
    end if;

    insert into public.recurring_saving_fulfillments (
      user_id, recurring_saving_id, ym, amount_vnd, source
    ) values (
      v_source.user_id, p_saving_id, p_ym, p_amount_vnd, 'recurring-topup'
    )
    on conflict (recurring_saving_id, ym) do update
      set amount_vnd = excluded.amount_vnd,
          source     = excluded.source,
          updated_at = now();

  end if;

  update public.recurring_savings
     set linked_deposit_tx_id = v_new_id, updated_at = now()
   where user_id = v_source.user_id
     and linked_deposit_tx_id = p_source_book_id;

  return v_book;
end;
$$;

comment on function public.open_successor_book(uuid, bigint, numeric, date, date, integer, text, uuid, text, uuid) is
  'Open the accumulating book that takes over from one that stopped accepting top-ups, moving the recurring link and the month with it (#638).';
