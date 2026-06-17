-- Optional explicit link from a recurring bank saving to a specific term
-- deposit. When a goal funds several recurring savings, name/sole matching can't
-- tell which one belongs to a maturing deposit, so the maturity "combine" flow
-- stays ambiguous. This column lets the user hard-link a recurring to a deposit;
-- linkedSavingFor's EXPLICIT tier then folds in exactly that one.
--
-- Keyed on transaction_id, which is STABLE across renewals (the active deposit
-- row rolls forward in place, keeping its id), so the link survives renewals.
-- ON DELETE SET NULL: deleting the deposit just unlinks the recurring saving,
-- it doesn't delete the saving.

ALTER TABLE recurring_savings
  ADD COLUMN IF NOT EXISTS linked_deposit_tx_id UUID
    REFERENCES investment_transactions(transaction_id) ON DELETE SET NULL;
