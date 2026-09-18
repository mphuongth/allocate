-- `funds.fund_type` admits 'etf'.
--
-- An exchange-traded fund is bought in units, valued as units × price, sold in
-- part, assigned to a goal and dollar-cost-averaged into — every one of which
-- this app already does, for the `funds` table. So an ETF holding is a `funds`
-- row, not a new `asset_type`: the alternative would be a second copy of the
-- purchase ledger, the sale invariants (#587) and the goal assignment, kept in
-- step by hand.
--
-- (`investment_transactions.asset_type` already carries a legacy 'stock' value.
-- It is not this: a 'stock' row is priced statically off its own unit_price and
-- has no automatic pricing at all.)
--
-- What genuinely differs is the PRICE, and that is application code rather than
-- schema. An open-ended fund's NAV comes from Fmarket, which lists no ETFs; an
-- ETF's market price comes from the exchange, and is a different number from the
-- fund manager's published NAV even for the same fund on the same day. The
-- column holds whichever one prices the holding.
--
-- Shipped on its own, ahead of the code that writes 'etf': a deploy that adds a
-- constraint value and depends on it in the same PR breaks its own preview,
-- which runs against a database that does not have the migration yet.
ALTER TABLE funds DROP CONSTRAINT IF EXISTS funds_fund_type_check;
ALTER TABLE funds ADD CONSTRAINT funds_fund_type_check
  CHECK (fund_type IN ('balanced', 'equity', 'debt', 'gold', 'etf'));
