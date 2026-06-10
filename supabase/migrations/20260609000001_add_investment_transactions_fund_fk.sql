-- investment_transactions.fund_id links a fund transaction to its fund, but the
-- foreign key was originally added out-of-band on the live database and never
-- captured in a migration (see 20260321000001_unify_investments.sql, which only
-- adds the bare column). As a result, a database built purely from migrations
-- (e.g. a local `supabase start` stack for E2E) has no FK, so PostgREST cannot
-- resolve the `funds(...)` embed in the dashboard overview query and returns a
-- 500 ("Could not find a relationship between 'investment_transactions' and
-- 'funds'").
--
-- Add the FK here so the migrated schema matches production. Guarded so it is a
-- no-op on any database that already has a FK from investment_transactions to
-- funds (i.e. production), avoiding a duplicate-constraint error on deploy.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'investment_transactions'::regclass
      AND confrelid = 'funds'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE investment_transactions
      ADD CONSTRAINT investment_transactions_fund_id_fkey
      FOREIGN KEY (fund_id) REFERENCES funds(id) ON DELETE SET NULL;
  END IF;
END $$;
