-- Add target_amount to savings_goals for dashboard progress tracking
ALTER TABLE savings_goals ADD COLUMN IF NOT EXISTS target_amount BIGINT CHECK (target_amount > 0);

-- Add coverage_type and amount_saved_vnd to insurance_members for dashboard display
ALTER TABLE insurance_members ADD COLUMN IF NOT EXISTS coverage_type TEXT;
ALTER TABLE insurance_members ADD COLUMN IF NOT EXISTS amount_saved_vnd BIGINT NOT NULL DEFAULT 0 CHECK (amount_saved_vnd >= 0);
