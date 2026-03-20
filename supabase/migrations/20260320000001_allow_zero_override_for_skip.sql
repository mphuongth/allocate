-- Allow monthly_amount_override_vnd = 0 to represent "skipped this month"
ALTER TABLE fixed_expense_overrides
  DROP CONSTRAINT IF EXISTS fixed_expense_overrides_monthly_amount_override_vnd_check;

ALTER TABLE fixed_expense_overrides
  ADD CONSTRAINT fixed_expense_overrides_monthly_amount_override_vnd_check
  CHECK (monthly_amount_override_vnd >= 0);
