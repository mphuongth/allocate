-- Re-expand active_investment_transactions so it carries every column the table
-- has — including successor_deposit_tx_id (#638, #659).
--
-- The view is `select * from investment_transactions`, and Postgres expands that
-- star ONCE, at creation. A column added later is simply not in the view, with no
-- error anywhere: 20260811000001 added successor_deposit_tx_id to the table and
-- nothing re-stated the view, so the column has been invisible to every reader
-- that goes through it ever since.
--
-- Which is the whole dashboard. lib/dashboardOverview reads the ledger from this
-- view, and PostgREST answers a select naming a column the view lacks with a 400 —
-- so the moment the overview asked for the promise, every screen fed by it went
-- blank at once. Found exactly that way: the targeted E2E lane failed 13 product
-- tests across dashboard.spec, accumulating-deposit.spec and the successor journey,
-- not one of them about successors.
--
-- 20260620000004 left the warning in its own header ("The dashboard overview reads
-- the held-pool columns FROM THIS VIEW ... so it must be re-expanded or the select
-- errors and the overview 500s"), and the same trap caught the next column added.
-- supabase/tests/successor_book.test.sql now asserts the view carries it, so a
-- third one is caught by the suite rather than by a blank dashboard.
--
-- security_invoker stays on — required, see 20260613000003.
create or replace view public.active_investment_transactions
  with (security_invoker = true) as
  select * from public.investment_transactions
  where renewed_from_transaction_id is null;

grant select on public.active_investment_transactions to authenticated;
