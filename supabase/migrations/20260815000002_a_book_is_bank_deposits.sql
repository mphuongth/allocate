-- A book is made of bank deposits, from the first row (#618).
--
-- An accumulating book ("Loại 2") is a BANK concept: the anchor self-groups
-- (deposit_group_id = its own transaction_id) and every tranche is the same bank
-- deposit, which is why the book-level fields — goal, maturity, notes, bank —
-- cascade across the group.
--
-- POST /api/v1/investment-transactions never said so on the branch that CREATES
-- a book: the top-up branch checks the anchor ("Can only top up an accumulating
-- bank deposit"), while `accumulating: true` was honoured for any asset type.
-- That route now refuses it, and this is the same rule on the table, for the
-- writers that never come through the route — RLS lets `authenticated` INSERT
-- its own investment_transactions rows straight through PostgREST, and the
-- browser holds that session.
--
-- What is already covered, and what is not. investment_transactions_subtype_shape
-- (20260802000001) requires deposit_group_id to be null on a fund/gold/stock
-- INVESTMENT, so the case #618 was filed about is refused by the database today.
-- Two shapes it cannot see, because it only measures investments:
--
--   • a WITHDRAWAL carrying a group. Nothing writes one — withdraw_book_close_group
--     parents its rows to the tranches and leaves the group off — and self-grouped
--     it would read as a live book to every path that keys on deposit_group_id
--     alone: lib/mergeEligibility ("not a single deposit"), update_deposit_book's
--     cascade, the recurring-link target list, create_held_settlement's refusal.
--     A book holding a balance nothing put there.
--   • a row with NO asset_type at all carrying a group — the CASE falls through
--     to `true`, and asset_type is nullable.
--
-- So the rule is stated once, positively: a grouped row is a bank investment.
-- Overlapping with the subtype constraint on the fund/gold/stock case is the
-- point — that one is about which columns an asset type may carry, this one is
-- about what a book is made of, and neither has to remember the other.
--
-- NOT VALID, the stance #611 and #588 took for the same reason: this validates
-- every INSERT and UPDATE from here on, but does not scan rows written before
-- it, so a migration cannot refuse to apply against real history and block the
-- deploy. #618 asks for the audit rather than a migration of old rows, and the
-- audit is this — read-only, run against production when convenient:
--
--   select transaction_id, asset_type, transaction_type, deposit_group_id
--     from public.investment_transactions
--    where deposit_group_id is not null
--      and (asset_type is distinct from 'bank' or transaction_type <> 'investment');
--
-- Expected to be empty: `accumulating` is only ever sent by the bank branch of
-- the add-transaction form, so a row like this would have to come from a
-- hand-made API call. If it does come back with rows, decide what they are
-- before validating the constraint; once it is empty, run
--   alter table public.investment_transactions
--     validate constraint investment_transactions_book_is_bank;
--
-- Covered by supabase/tests/deposit_book_tranche_guard.test.sql (`npm run test:db`).

alter table public.investment_transactions
  drop constraint if exists investment_transactions_book_is_bank;

alter table public.investment_transactions
  add constraint investment_transactions_book_is_bank
  check (
    deposit_group_id is null
    or (asset_type = 'bank' and transaction_type = 'investment')
  ) not valid;

comment on constraint investment_transactions_book_is_bank on public.investment_transactions is
  'An accumulating book is made of bank deposits: only a bank investment may carry a deposit_group_id (#618).';
