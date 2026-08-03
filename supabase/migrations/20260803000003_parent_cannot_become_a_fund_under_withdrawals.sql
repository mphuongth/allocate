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
-- Scope, deliberately narrow:
--   • Only BECOMING one. A row that is already a fund purchase is untouched, so
--     ordinary edits to a fund holding still work, and the legacy rows already in
--     the ledger keep the meaning the reader gives them.
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
          or old.fund_id is distinct from new.fund_id) then
    if exists (
      select 1
        from public.investment_transactions w
       where w.parent_transaction_id = new.transaction_id
         and w.transaction_type = 'withdrawal'
         and (w.asset_type is distinct from 'fund' or w.fund_id is null)
    ) then
      -- Prefixed like every other refusal in this family so the API maps it to a
      -- 400 with the one match it already has.
      raise exception 'withdrawal invariant: holding % cannot become a fund purchase while a withdrawal that is not keyed by a fund draws on it',
        new.transaction_id using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_parent_not_fund_under_withdrawals() is
  'Refuses turning a holding into a fund purchase while non-fund-keyed withdrawals draw on it — the other door into the shape 20260803000002 refuses (#606).';

revoke all on function public.enforce_parent_not_fund_under_withdrawals() from public;
revoke all on function public.enforce_parent_not_fund_under_withdrawals() from anon, authenticated;

drop trigger if exists investment_transactions_parent_not_fund on public.investment_transactions;
create trigger investment_transactions_parent_not_fund
  before update of asset_type, fund_id
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'investment')
  execute function public.enforce_parent_not_fund_under_withdrawals();
