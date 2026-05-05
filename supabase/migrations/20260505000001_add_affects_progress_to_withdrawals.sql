ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS affects_progress BOOLEAN NOT NULL DEFAULT true;
