-- Update fund_type enum: balanced/equity/debt/gold (removed hybrid, other; added balanced)
ALTER TABLE funds DROP CONSTRAINT IF EXISTS funds_fund_type_check;
ALTER TABLE funds ADD CONSTRAINT funds_fund_type_check
  CHECK (fund_type IN ('balanced', 'equity', 'debt', 'gold'));
