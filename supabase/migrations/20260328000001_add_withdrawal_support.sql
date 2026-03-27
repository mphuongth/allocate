-- Make asset_type nullable so withdrawal records don't require one
ALTER TABLE investment_transactions ALTER COLUMN asset_type DROP NOT NULL;

-- Add transaction_type to distinguish investments from withdrawals
ALTER TABLE investment_transactions
  ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'investment'
  CHECK (transaction_type IN ('investment', 'withdrawal'));

-- Investments still require asset_type; withdrawals do not
ALTER TABLE investment_transactions
  ADD CONSTRAINT require_asset_type_for_investments
  CHECK (transaction_type = 'withdrawal' OR asset_type IS NOT NULL);
