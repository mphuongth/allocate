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
    or (deposit_group_id = transaction_id and successor_deposit_tx_id <> transaction_id)
  );

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
create or replace function public.enforce_successor_book_pairing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_successor public.investment_transactions;
begin
  if new.successor_deposit_tx_id is null then return new; end if;

  select * into v_successor from public.investment_transactions
   where transaction_id = new.successor_deposit_tx_id and user_id = new.user_id;
  -- Ownership is the fk trigger's job; say nothing here about a row that is not
  -- the caller's, so a foreign book cannot be probed through these messages.
  if not found then return new; end if;

  if v_successor.deposit_group_id is distinct from v_successor.transaction_id then
    raise exception 'successor book: a successor must itself be an accumulating book'
      using errcode = 'check_violation';
  end if;
  if v_successor.goal_id is distinct from new.goal_id then
    raise exception 'successor book: both books must belong to the same goal'
      using errcode = 'check_violation';
  end if;
  if coalesce(v_successor.currency, 'VND') is distinct from coalesce(new.currency, 'VND') then
    raise exception 'successor book: both books must be in the same currency'
      using errcode = 'check_violation';
  end if;
  if v_successor.successor_deposit_tx_id = new.transaction_id then
    raise exception 'successor book: two books cannot succeed each other'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists investment_transactions_successor_pairing on public.investment_transactions;
create trigger investment_transactions_successor_pairing
  before insert or update of successor_deposit_tx_id, goal_id, currency
  on public.investment_transactions
  for each row
  when (new.successor_deposit_tx_id is not null)
  execute function public.enforce_successor_book_pairing();

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
  if p_expiry_date is null or p_investment_date is null or p_expiry_date <= p_investment_date then
    raise exception 'successor book: the new maturity must come after the contribution'
      using errcode = 'check_violation';
  end if;
  if p_investment_date > current_date + 1 then
    raise exception 'successor book: contribution date cannot be in the future'
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

  -- Recurring-driven: the month is contributed to B, marked fulfilled, and the
  -- saving now points at B. A saving linked elsewhere is not this flow's to move.
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

    update public.recurring_savings
       set linked_deposit_tx_id = v_new_id, updated_at = now()
     where saving_id = p_saving_id;
  end if;

  return v_book;
end;
$$;

comment on function public.open_successor_book(uuid, bigint, numeric, date, date, integer, text, uuid, text, uuid) is
  'Open the accumulating book that takes over from one that stopped accepting top-ups, moving the recurring link and the month with it (#638).';
