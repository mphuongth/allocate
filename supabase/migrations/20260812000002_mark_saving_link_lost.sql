-- Record when a recurring saving loses its deposit link to a deletion (#655).
--
-- `linked_deposit_tx_id` is ON DELETE SET NULL, so deleting the deposit a
-- recurring saving funds unlinks the saving and says nothing anywhere. Nothing
-- is corrupt — an unlinked saving is a legal, common shape — which is exactly
-- why the plan can't warn about it: most unlinked savings were never linked at
-- all. Without a record of the loss there is no honest way to tell the two
-- apart, so the monthly line goes on looking healthy while the money it
-- describes no longer reaches the book the user pointed it at.
--
-- The handover flow (#638) is where this bites hardest: opening a successor
-- moves the saving's link onto the new book, so deleting that book is the one
-- click that quietly stops the routing the user set up.
--
-- Two rules, and the second is as important as the first:
--   • a DELETE of the linked deposit stamps `unlinked_at`;
--   • the user clearing the link themselves does NOT — that is a decision, and
--     nagging about a choice teaches the user to ignore the warning.
-- Re-linking clears the stamp, which is the user answering the warning.
--
-- BEFORE DELETE, not AFTER: the foreign key's own SET NULL runs as an after-row
-- action, so by AFTER DELETE the link this needs to match on is already gone.
-- It writes `recurring_savings` while the delete targets
-- `investment_transactions`, so it never collides with the FK's write on the row
-- being deleted.
--
-- SECURITY DEFINER with an explicit user_id filter, matching
-- `clear_recurring_link_on_hold` (20260727000003): the mark is authoritative
-- regardless of the caller's RLS visibility, and can only ever touch the
-- deleted row's own owner.

alter table public.recurring_savings
  add column if not exists unlinked_at timestamptz;

-- A link may target either an accumulating book's anchor — where the monthly
-- contribution really was going into that book — or a single term deposit, where
-- the link only tells the maturity-combine picker which saving belongs to it and
-- the contribution was already recorded as a standalone deposit. Losing the two
-- has different consequences, and the plan must not tell a term-deposit user
-- that their routing changed when it never did. The kind is knowable only here,
-- while the row being deleted still exists.
alter table public.recurring_savings
  add column if not exists unlinked_from_book boolean;

comment on column public.recurring_savings.unlinked_at is
  'When this saving''s linked deposit was deleted out from under it (#655). Null once the saving is linked again, or if it was never linked. Advisory only — no money depends on it.';

comment on column public.recurring_savings.unlinked_from_book is
  'Whether the deposit deleted in #655 was an accumulating book anchor (the contribution was being paid into it) rather than a single term deposit. Advisory: it only decides which sentence the plan shows.';

create or replace function public.mark_saving_link_lost()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deleting the account cascades to both tables, and the saving being marked is
  -- itself on its way out. Writing to it then re-checks its owner FK against a
  -- `auth.users` row the cascade has already removed, which aborts the account
  -- deletion over an advisory flag. Nobody is left to read the warning, so skip
  -- it: the owner still existing is what makes the mark worth writing.
  update public.recurring_savings
     set unlinked_at = now(),
         -- An anchor is a book: deposit_group_id pointing at its own row. A
         -- plain term deposit has no group at all, and the link validator
         -- accepts nothing in between.
         unlinked_from_book = (old.deposit_group_id is not distinct from old.transaction_id),
         updated_at = now()
   where linked_deposit_tx_id = old.transaction_id
     and user_id = old.user_id
     and exists (select 1 from auth.users u where u.id = old.user_id);
  return old;
end;
$$;

drop trigger if exists investment_transactions_mark_saving_link_lost on public.investment_transactions;
create trigger investment_transactions_mark_saving_link_lost
  before delete on public.investment_transactions
  for each row
  execute function public.mark_saving_link_lost();

comment on function public.mark_saving_link_lost() is
  'Stamps unlinked_at on any recurring saving whose linked deposit is being deleted, so the plan can say the routing stopped (#655).';

-- The mark is a question the user answers by pointing the saving at another
-- deposit. A BEFORE UPDATE on the row itself, so re-linking costs no extra write
-- — and a link the user clears by hand leaves the stamp alone, since that path
-- never sets a link.
create or replace function public.clear_saving_unlinked_mark()
returns trigger
language plpgsql
as $$
begin
  new.unlinked_at := null;
  new.unlinked_from_book := null;
  return new;
end;
$$;

drop trigger if exists recurring_savings_clear_unlinked_mark on public.recurring_savings;
create trigger recurring_savings_clear_unlinked_mark
  before update on public.recurring_savings
  for each row
  when (new.linked_deposit_tx_id is not null
        and new.linked_deposit_tx_id is distinct from old.linked_deposit_tx_id)
  execute function public.clear_saving_unlinked_mark();

comment on function public.clear_saving_unlinked_mark() is
  'Clears unlinked_at when a recurring saving is pointed at a deposit again (#655).';
