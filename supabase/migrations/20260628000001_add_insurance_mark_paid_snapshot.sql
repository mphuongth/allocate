-- Snapshot the dates mark-paid overwrites, so a settlement can be undone.
--
-- mark-paid advances payment_date by a year and stamps last_payment_date = today,
-- discarding the prior values. Without a snapshot an accidental settlement cannot
-- be reversed. These two nullable columns hold the one-level-back state; the undo
-- endpoint restores from them and clears them (so undo is one-shot per settlement).
ALTER TABLE insurance_members
  ADD COLUMN IF NOT EXISTS prev_payment_date DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS prev_last_payment_date TIMESTAMP WITH TIME ZONE DEFAULT NULL;
