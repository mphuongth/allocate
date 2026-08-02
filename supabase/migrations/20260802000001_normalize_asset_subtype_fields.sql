-- One row per holding, one subtype's fields in it (#593).
--
-- investment_transactions is a single wide table shared by every kind of
-- holding: a fund's fund_id/units/unit_price, a deposit's
-- interest_rate/expiry_date/bank_code/interest_earned_vnd/deposit_group_id and
-- gold's units/unit_price all sit side by side, all nullable. Editing a
-- transaction can change its asset type, and the edit payload only ever carried
-- the NEW type's fields — nothing cleared the old ones. So Bank -> Fund/Gold
-- kept the rate, the maturity and the bank code, and Gold -> Bank kept units and
-- unit price. The row then describes two kinds of holding at once and every
-- later reader — valuation, reports, the next migration — has to guess which
-- half is true.
--
-- The edit route now clears the previous subtype (lib/assetTypeFields.ts), but a
-- route is only one writer: RPCs, service-role scripts and psql all reach this
-- table too. The shape belongs on the table, for the same reason the withdrawal
-- balance does (20260730000002).
--
--   asset_type | may carry
--   -----------|--------------------------------------------------------------
--   fund       | fund_id, units, unit_price
--   gold       | units, unit_price
--   stock      | units, unit_price            (legacy; priced like gold)
--   bank       | interest_rate, expiry_date, bank_code, interest_earned_vnd,
--              | deposit_group_id
--
-- Scope: INVESTMENT rows. A withdrawal is a movement, not a holding — it is
-- keyed by parent_transaction_id and carries principal_withdrawn/units_withdrawn
-- whose shape the withdrawal invariant already owns (20260730000002) — so
-- constraining it here would duplicate one contract across two places and
-- disagree with it eventually. Rows with a null asset_type (legacy) are left
-- alone: there is no subtype to check.
--
-- Covered by supabase/tests/asset_subtype_shape.test.sql (`npm run test:db`).

begin;

-- ── Normalize what is already contradictory ─────────────────────────────────
-- These columns cannot be recovered — a bank code on a gold row was never read
-- by anything — so clearing them loses no information, and it is what makes the
-- constraint below addable as VALID rather than deferred to the next write.

-- Deposits carry no fund link and no units.
update public.investment_transactions
set fund_id = null, units = null, unit_price = null
where transaction_type = 'investment'
  and asset_type = 'bank'
  and (fund_id is not null or units is not null or unit_price is not null);

-- Funds carry no deposit terms.
update public.investment_transactions
set interest_rate = null, expiry_date = null, bank_code = null,
    interest_earned_vnd = null, deposit_group_id = null
where transaction_type = 'investment'
  and asset_type = 'fund'
  and (interest_rate is not null or expiry_date is not null or bank_code is not null
       or interest_earned_vnd is not null or deposit_group_id is not null);

-- Gold and stock carry neither a fund link nor deposit terms.
update public.investment_transactions
set fund_id = null, interest_rate = null, expiry_date = null, bank_code = null,
    interest_earned_vnd = null, deposit_group_id = null
where transaction_type = 'investment'
  and asset_type in ('gold', 'stock')
  and (fund_id is not null or interest_rate is not null or expiry_date is not null
       or bank_code is not null or interest_earned_vnd is not null
       or deposit_group_id is not null);

-- ── Enforce it from here on ─────────────────────────────────────────────────
alter table public.investment_transactions
  drop constraint if exists investment_transactions_subtype_shape;

alter table public.investment_transactions
  add constraint investment_transactions_subtype_shape check (
    transaction_type <> 'investment'
    or asset_type is null
    or case asset_type
         when 'bank' then
           fund_id is null and units is null and unit_price is null
         when 'fund' then
           interest_rate is null and expiry_date is null and bank_code is null
           and interest_earned_vnd is null and deposit_group_id is null
         when 'gold' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
         when 'stock' then
           fund_id is null and interest_rate is null and expiry_date is null
           and bank_code is null and interest_earned_vnd is null and deposit_group_id is null
         else true
       end
  );

comment on constraint investment_transactions_subtype_shape on public.investment_transactions is
  'An investment row carries only its own asset type''s fields (#593). See lib/assetTypeFields.ts for the same table in application code.';

commit;
