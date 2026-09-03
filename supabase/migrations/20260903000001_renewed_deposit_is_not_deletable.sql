-- A deposit that carries renewal history cannot be deleted out from under it.
--
-- Neither renewing a term deposit nor collapsing an accumulating book creates a
-- row for the new cycle. Both roll the SAME row forward in place and append a
-- history snapshot of the cycle that closed, linked back by
-- renewed_from_transaction_id (20260613000001, and the collapse loop in
-- 20260817000002). One consequence of that design was never handled: the row a
-- user sees in Recent Activity dated "the day I renewed" IS the deposit. It reads
-- like a record OF the renewal, and the ledger offers a delete button on every
-- row, so deleting it looks like tidying history and actually removes the
-- holding.
--
-- The link is ON DELETE SET NULL, which is what turns a mistaken click into
-- silent corruption. Every snapshot loses its parent and re-enters
-- active_investment_transactions as a LIVE holding of a closed cycle — old
-- principal, old maturity, old rate, and `affects_progress = false` left over
-- from its life as history. Net worth moves, one deposit becomes N fragments of
-- a deposit that no longer exists, and nothing says a renewal was undone.
--
-- Observed: a five-tranche PVcomBank book in an emergency-fund goal, collapsed at
-- maturity into one 55M deposit; the collapsed row deleted from Recent Activity;
-- the book back as five bankless orphans totalling 54M, absent from "needs
-- attention" as a book and unrecognisable to its owner.
--
-- ─── Why the guard lives on the SNAPSHOT's update ────────────────────────────
--
-- Caught as the foreign key performs its own SET NULL — a BEFORE UPDATE on the
-- referencing row — exactly as refuse_orphaning_a_claim is (20260804000001). By
-- AFTER DELETE the link this has to read is already erased, so this is the last
-- moment the relationship is knowable. The DELETE route's own WHERE clause can't
-- express it either: it would need a NOT EXISTS subquery the client cannot send.
--
-- Two carve-outs, both mirrored from that function:
--   • the source still existing means somebody cleared the link deliberately —
--     a different act, and not this one's to refuse;
--   • the account cascade removes the deposit and its history together, and
--     `auth.users` is already gone by the time this fires. Refusing there would
--     strand an account over history nobody is left to read.
--
-- Covered by supabase/tests/renewed_deposit_not_deletable.test.sql
-- (`npm run test:db`).

create or replace function public.refuse_orphaning_renewal_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.investment_transactions t
     where t.transaction_id = old.renewed_from_transaction_id
  ) then
    return new;
  end if;

  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return new;
  end if;

  -- No count in the message: by the time this fires the foreign key may already
  -- have nulled some siblings, so any number here would be the arbitrary one for
  -- whichever row Postgres reached first. The route translates this into the
  -- sentence the user reads; what it needs from the database is which rule was
  -- broken, not a tally.
  raise exception 'renewal history: this deposit records closed cycles and cannot be deleted while they point at it'
    using errcode = 'check_violation';
end;
$$;

comment on function public.refuse_orphaning_renewal_history() is
  'Refuses deleting a deposit that renewal/collapse history still points at, caught as the FK orphans the snapshot because that is the last moment the link is readable.';

revoke all on function public.refuse_orphaning_renewal_history() from public, anon, authenticated;

drop trigger if exists investment_transactions_renewal_history_kept on public.investment_transactions;
create trigger investment_transactions_renewal_history_kept
  before update of renewed_from_transaction_id on public.investment_transactions
  for each row
  when (old.renewed_from_transaction_id is not null
        and new.renewed_from_transaction_id is null)
  execute function public.refuse_orphaning_renewal_history();
