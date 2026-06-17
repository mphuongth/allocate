-- Accumulating ("Loại 2") bank deposits: one logical book you can top up any
-- time, each top-up a tranche with its own rate, all sharing the book's
-- maturity. A tranche is just an investment_transactions row, so the only new
-- structure is a grouping key.
--
-- deposit_group_id groups a book's tranches:
--   • term deposit / one-off holding → NULL (unchanged behaviour),
--   • accumulating book ANCHOR row   → equals its own transaction_id (self-group),
--   • accumulating top-up row        → equals the anchor's transaction_id.
-- So `deposit_group_id IS NOT NULL` ⇔ the row belongs to an accumulating book,
-- and the anchor is the row where deposit_group_id = transaction_id. Display
-- layers group-by this id and sum; net-worth/goal totals already sum every row.
--
-- The book's maturity is a book property: every tranche carries the SAME
-- expiry_date (copied down at top-up time) so per-row valuation stays local and
-- never has to join back up to the anchor.

ALTER TABLE investment_transactions
  ADD COLUMN IF NOT EXISTS deposit_group_id UUID;

-- Fast "give me this book's tranches" lookups (and the display group-by).
CREATE INDEX IF NOT EXISTS idx_investment_transactions_deposit_group
  ON investment_transactions (deposit_group_id)
  WHERE deposit_group_id IS NOT NULL;

-- The dashboard reads the snapshot-free view, whose SELECT * froze its column
-- list when it was created (20260613000003) — so it does NOT expose a column
-- added afterwards. Recreate it so deposit_group_id flows through to the
-- overview query (otherwise selecting it there errors).
CREATE OR REPLACE VIEW active_investment_transactions AS
SELECT * FROM investment_transactions
WHERE renewed_from_transaction_id IS NULL;
