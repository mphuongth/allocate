ALTER TABLE fixed_expenses
  ADD COLUMN effective_from DATE,
  ADD COLUMN effective_to DATE;

ALTER TABLE fixed_expenses
  ADD CONSTRAINT effective_dates_order CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to
  );
