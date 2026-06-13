-- Term-deposit renewal lineage.
--
-- A renewal still overwrites the active deposit row in place (its valuation is
-- unchanged). To preserve the history that the overwrite would otherwise erase
-- — the original open date, principal, rate and the maturity that just passed —
-- each renewal also appends a history-only "snapshot" row of the cycle that
-- closed. That snapshot points at the still-active deposit via this column.
--
-- A row with renewed_from_transaction_id SET is a closed past cycle: it must
-- never be counted in net worth / allocation / goal progress / active holdings
-- (it is excluded everywhere investments are summed). The same link lets a
-- future "renewed N times / total interest" summary gather a deposit's cycles
-- without guessing.
ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS renewed_from_transaction_id UUID
  REFERENCES investment_transactions(transaction_id) ON DELETE SET NULL;

-- Speeds up "all snapshots of deposit X" lookups (future summary) and the
-- default "exclude snapshots" filter.
CREATE INDEX IF NOT EXISTS idx_investment_transactions_renewed_from
  ON investment_transactions (renewed_from_transaction_id);
