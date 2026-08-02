-- A tranche stays in its book, as the kind of holding the book is made of (#593).
--
-- 20260802000001 fixed the row shape: an investment carries only its own asset
-- type's columns. That alone still leaves one way to strand a book. RLS lets
-- `authenticated` UPDATE its own investment_transactions rows straight through
-- PostgREST — the browser holds that session — so a direct write can flip a
-- tranche to gold/fund AND clear deposit_group_id in the same statement. The
-- subtype CHECK sees a perfectly clean gold row and passes; the remaining
-- tranches are left in a book whose principal no longer adds up, and renewal,
-- collapse and book withdrawal each read a different holding than the user has.
--
-- The API refuses the conversion (PUT /api/v1/investment-transactions/[id]), but
-- an API guard only binds callers who go through the API. The invariant belongs
-- on the table, for the same reason the withdrawal balance does (20260730000002).
--
-- Three rules, and what each one leaves alone:
--
--   1. While a row is in a book, its asset_type is fixed. Nothing legitimate
--      converts a tranche; a book is bank deposits by definition.
--   2. A tranche cannot be moved into a different book. Nothing legitimate
--      re-parents one, and a moved tranche would be double-counted in one book
--      and missing from the other.
--   3. A tranche may LEAVE a book only when the book is dissolved with it —
--      checked at the end of the statement, because that is the shape of the two
--      flows that legitimately do it: `withdraw_book_close_group` clears the
--      whole group in one UPDATE, and `collapse_accumulating_book` deletes the
--      other tranches first and then clears the anchor. Both leave nothing
--      behind, which is precisely the condition.
--
-- Rule 3 is a statement-end check rather than a row-level one because a book is
-- dissolved as a set, not row by row. It cannot be a role check: those RPCs are
-- SECURITY INVOKER, so they run as `authenticated` too — the database cannot
-- tell them apart from a direct PATCH by who is asking, only by what is left.
--
-- Covered by supabase/tests/deposit_book_tranche_guard.test.sql (`npm run test:db`).

begin;

create or replace function public.enforce_deposit_book_tranche_shape()
returns trigger
language plpgsql
as $$
begin
  if new.asset_type is distinct from old.asset_type then
    raise exception 'deposit book: a tranche of an accumulating book cannot change asset type'
      using errcode = 'check_violation';
  end if;

  if new.deposit_group_id is not null and new.deposit_group_id <> old.deposit_group_id then
    raise exception 'deposit book: a tranche cannot be moved into another book'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_deposit_book_tranche_shape() is
  'A booked deposit keeps its asset type and its book (#593).';

drop trigger if exists investment_transactions_book_tranche_shape on public.investment_transactions;
create trigger investment_transactions_book_tranche_shape
  before update of asset_type, deposit_group_id on public.investment_transactions
  for each row
  when (old.deposit_group_id is not null)
  execute function public.enforce_deposit_book_tranche_shape();

create or replace function public.enforce_deposit_book_dissolved_whole()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.investment_transactions
     where deposit_group_id = old.deposit_group_id
  ) then
    raise exception 'deposit book: a tranche cannot leave a book that still has members'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

comment on function public.enforce_deposit_book_dissolved_whole() is
  'A tranche leaves a book only when the whole book is dissolved with it, checked at the end of the statement (#593).';

drop trigger if exists investment_transactions_book_dissolved_whole on public.investment_transactions;
create constraint trigger investment_transactions_book_dissolved_whole
  after update of deposit_group_id on public.investment_transactions
  -- INITIALLY IMMEDIATE on a constraint trigger means "at the end of the
  -- statement", which is where a whole-book dissolve becomes visible. A caller
  -- that genuinely needs several statements can still SET CONSTRAINTS DEFERRED.
  deferrable initially immediate
  for each row
  when (old.deposit_group_id is not null and new.deposit_group_id is null)
  execute function public.enforce_deposit_book_dissolved_whole();

commit;
