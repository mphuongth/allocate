-- Cost basis of the amount being withdrawn (bank/fund/gold)
ALTER TABLE investment_transactions
  ADD COLUMN principal_withdrawn BIGINT;

-- Units sold for fund/gold withdrawals
ALTER TABLE investment_transactions
  ADD COLUMN units_withdrawn NUMERIC;
