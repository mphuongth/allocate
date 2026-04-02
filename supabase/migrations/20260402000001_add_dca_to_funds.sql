-- Add DCA configuration to funds table
ALTER TABLE funds
  ADD COLUMN is_dca BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN dca_monthly_amount_vnd BIGINT NULL CHECK (dca_monthly_amount_vnd IS NULL OR dca_monthly_amount_vnd > 0);

-- Track which investment_transactions were auto-seeded by DCA
ALTER TABLE investment_transactions
  ADD COLUMN is_dca_seeded BOOLEAN NOT NULL DEFAULT false;
