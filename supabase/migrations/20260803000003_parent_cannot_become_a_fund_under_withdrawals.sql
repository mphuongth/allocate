-- A holding cannot turn into a fund purchase under withdrawals that draw on it.
--
-- 20260803000002 refuses a fund sale that names a purchase as its parent, but it
-- guards the WITHDRAWAL's own writes. The same forbidden shape can be assembled
-- from the other end, and nothing fired: PUT /api/v1/investment-transactions/[id]
-- lets a holding change asset_type (#593), so a perfectly ordinary bank deposit
-- with a withdrawal hanging off it can be edited into a fund purchase — and the
-- withdrawal, untouched by that statement, wakes up parented to a fund.
--
-- Verified against the local stack before this migration: the conversion went
-- through in silence. From then on lib/withdrawalProgress redirects the child into
-- the fund's (goal, fund) bucket while check_withdrawal_balance would have measured
-- it against the parent's own principal — the two balances #606 exists to collapse,
-- reachable again through a door the child's trigger cannot see.
--
-- So the parent is asked the question instead: it may become a fund purchase only
-- when nothing draws on it that isn't already fund-keyed. The withdrawal has to be
-- given its fund (or removed) first — the same end state 20260803000002 demands of
-- a new sale, asked of the edit that would create the shape.
--
-- The same statement is also the only thing that can move the RATE a legacy child's
-- units are derived at. Those units are `parent units x principal / parent amount`,
-- so editing the purchase's amount_vnd or units rewrites how much the dashboard
-- takes out of the bucket for a row nothing re-measured — two principal-only
-- children of a 50-unit / 2,000,000 purchase derive 12.5 units each today and 25
-- each if the purchase is re-priced to half the units. The guard covers that edit
-- too, for a purchase that HAS such a child.
--
-- (The general case — lowering a holding's amount below what has already been
-- withdrawn — is the mirror hole 20260730000002 names in its header and #608 owns.
-- This is only the part #606 introduced by deriving from the parent's price.)
--
-- Scope, deliberately narrow:
--   • Only a purchase with a non-fund-keyed child. An ordinary fund holding, whose
--     sells carry their own fund, is created and edited exactly as before, and the
--     legacy rows already in the ledger keep the meaning the reader gives them.
--   • Only rows that carry a fund. Clearing fund_id — which ON DELETE SET NULL does
--     for the whole table when a fund is deleted — is the opposite direction and
--     must never raise (see 20260803000002's own handling of that cascade).
--   • Only non-fund-keyed children. A sell that carries asset_type='fund' + fund_id
--     draws on its own bucket whatever its parent is, exactly as it did before.
create or replace function public.enforce_parent_not_fund_under_withdrawals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.transaction_type = 'investment'
     and new.asset_type = 'fund' and new.fund_id is not null
     and (old.asset_type is distinct from new.asset_type
          or old.fund_id is distinct from new.fund_id
          -- The purchase's own PRICE is the rate a legacy child's units are derived
          -- at (units x principal / amount, lib/withdrawalProgress), so editing it
          -- silently rewrites how much the dashboard takes out of the bucket for a
          -- row nothing re-measured. Only a purchase that HAS such a child is
          -- affected: an ordinary fund holding, whose sells carry their own fund,
          -- is edited exactly as before.
          or old.amount_vnd is distinct from new.amount_vnd
          or old.units is distinct from new.units) then
    if exists (
      select 1
        from public.investment_transactions w
       where w.parent_transaction_id = new.transaction_id
         and w.transaction_type = 'withdrawal'
         and (w.asset_type is distinct from 'fund' or w.fund_id is null)
    ) then
      -- Prefixed like every other refusal in this family so the API maps it to a
      -- 400 with the one match it already has.
      if old.asset_type is distinct from new.asset_type or old.fund_id is distinct from new.fund_id then
        raise exception 'withdrawal invariant: holding % cannot become a fund purchase while a withdrawal that is not keyed by a fund draws on it',
          new.transaction_id using errcode = 'check_violation';
      end if;
      raise exception 'withdrawal invariant: fund purchase % cannot change its amount or units while a withdrawal that is not keyed by a fund draws on it — that row''s units are derived from this purchase',
        new.transaction_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_parent_not_fund_under_withdrawals() is
  'Refuses turning a holding into a fund purchase, or re-pricing one, while non-fund-keyed withdrawals draw on it — the other door into the shape 20260803000002 refuses, and the rate their units are derived at (#606).';

revoke all on function public.enforce_parent_not_fund_under_withdrawals() from public;
revoke all on function public.enforce_parent_not_fund_under_withdrawals() from anon, authenticated;

drop trigger if exists investment_transactions_parent_not_fund on public.investment_transactions;
create trigger investment_transactions_parent_not_fund
  before update of asset_type, fund_id, amount_vnd, units
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'investment')
  execute function public.enforce_parent_not_fund_under_withdrawals();
