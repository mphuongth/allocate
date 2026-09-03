-- A book's anchor cannot be deleted out from under its top-ups.
--
-- An accumulating ("Loại 2") book is the set of rows sharing a deposit_group_id,
-- and that group IS the anchor's own transaction_id. Every other
-- transaction-to-transaction reference in this table is a real foreign key;
-- deposit_group_id is not one (20260617000001 adds it as a bare uuid, and
-- 20260723000001 guards only its ownership). So nothing stopped the anchor from
-- being deleted while its top-ups still named it — and the ledger shows a delete
-- button on the anchor row like on any other.
--
-- The damage is quiet, which is what makes it worth a guard. Nothing looks wrong:
-- goalDetailRows groups by deposit_group_id and falls back to the first surviving
-- tranche for the book's terms, so the holding still renders as one row and the
-- money is still counted. It fails at maturity, possibly months later —
-- collapse_accumulating_book looks its anchor up as `transaction_id = p_group_id
-- and deposit_group_id = p_group_id`, finds nothing, and answers "accumulating
-- book not found". The book can never be renewed again, and by then the delete
-- that caused it is far out of sight.
--
-- Same family as 20260903000001 and refused on the same principle: what makes a
-- row undeletable is what still points at it.
--
-- ─── Why a DEFERRED constraint trigger, not a BEFORE DELETE ─────────────────
--
-- A book is dissolved as a set, not row by row — the same reasoning
-- enforce_deposit_book_dissolved_whole (20260802000002) gives for the UPDATE
-- side, and it cannot be a role check either: the RPCs are SECURITY INVOKER and
-- run as `authenticated` too, so the database can tell them apart only by what
-- they leave behind.
--
-- Asked at commit, the question answers itself for every legitimate flow, with no
-- carve-out list to keep in step with the RPCs:
--   • collapse_accumulating_book deletes only NON-anchor tranches and then clears
--     the anchor's group, so no anchor is ever deleted by it;
--   • merge_book_into_successor and withdraw_book_close_group dissolve a book by
--     clearing deposit_group_id across the group, never by deleting rows;
--   • deleting a whole book, and the account cascade, both leave nothing naming
--     the anchor.
-- What is left is the one case this exists for: the anchor removed on its own.
--
-- Covered by supabase/tests/book_anchor_not_deletable.test.sql (`npm run test:db`).

create or replace function public.refuse_orphaning_book_tranches()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.investment_transactions t
     where t.deposit_group_id = old.transaction_id
  ) then
    raise exception 'deposit book: this deposit anchors an accumulating book that still holds top-ups, so it cannot be removed on its own'
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

comment on function public.refuse_orphaning_book_tranches() is
  'Refuses deleting an accumulating book''s anchor while its top-ups still name it, measured at commit so dissolving the whole book still goes through.';

revoke all on function public.refuse_orphaning_book_tranches() from public, anon, authenticated;

drop trigger if exists investment_transactions_book_anchor_kept on public.investment_transactions;
create constraint trigger investment_transactions_book_anchor_kept
  after delete on public.investment_transactions
  deferrable initially deferred
  for each row
  -- Only an anchor can be named by other rows, and an anchor is the row whose
  -- group is itself. Every other delete — a top-up, a fund purchase, a
  -- withdrawal — skips this entirely.
  when (old.deposit_group_id is not distinct from old.transaction_id)
  execute function public.refuse_orphaning_book_tranches();
