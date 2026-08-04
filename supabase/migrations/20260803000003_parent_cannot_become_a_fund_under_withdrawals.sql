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
-- units are DERIVED at. Those units are `parent units x principal / parent amount`,
-- so editing the purchase's amount_vnd or units rewrites how much the dashboard
-- takes out of the bucket for a row nothing re-measured — two principal-only
-- children of a 50-unit / 2,000,000 purchase derive 12.5 units each today and 25
-- each if the purchase is re-priced to half the units. The guard covers that edit
-- too, and only for children that are actually derived from it: one that RECORDS a
-- positive units_withdrawn is read as written, so it must not freeze the edit.
--
-- (The general case — lowering a holding below what has already been withdrawn — is
-- the mirror hole 20260730000002 names in its header and #608 owns. It is NOT
-- special to legacy children: shrinking a fund purchase under an ordinary
-- fund-keyed sell leaves the same bucket owing units it does not hold, today,
-- unchanged by any of this. What #606 adds is that a legacy child now draws on the
-- bucket like any other sell — so it joins that hole rather than making a new one,
-- and the fix belongs where the whole class is fixed. What is guarded here is only
-- the part #606 did introduce: the RATE such a child's units are derived at, which
-- nothing but this edit can move.)
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
declare
  v_rate_kept        boolean;
  v_max_principal    bigint;
  v_derived_children int;
begin
  -- `units > 0` mirrors lib/withdrawalProgress: a purchase with no units is no
  -- bucket (the dashboard values it as an ordinary holding), so a withdrawal on it
  -- stays on the parent axis and none of this applies.
  if new.transaction_type is distinct from 'investment'
     or new.asset_type is distinct from 'fund' or new.fund_id is null
     or coalesce(new.units, 0) <= 0 then
    return new;
  end if;

  -- BECOMING a fund purchase: every non-fund-keyed child would wake up parented to
  -- a fund, which is the shape 20260803000002 refuses at the child's own door.
  --
  -- transaction_type counts as becoming one, and the trigger lists it too. Without
  -- that, the guard was two updates wide: turn the parent into a valid fund-keyed
  -- WITHDRAWAL first (this function returns — it is no longer an investment), then
  -- flip transaction_type back on its own. The second statement changed no column
  -- this trigger watched and left a fund purchase sitting under the legacy child,
  -- which is the whole shape the migration exists to prevent. Verified against the
  -- local stack: both steps were accepted.
  if (old.asset_type is distinct from new.asset_type
      or old.fund_id is distinct from new.fund_id
      or old.transaction_type is distinct from new.transaction_type)
     and exists (
       select 1
         from public.investment_transactions w
        where w.parent_transaction_id = new.transaction_id
          and w.transaction_type = 'withdrawal'
          and (w.asset_type is distinct from 'fund' or w.fund_id is null)
     ) then
    -- Prefixed like every other refusal in this family so the API maps it to a 400
    -- with the one match it already has.
    raise exception 'withdrawal invariant: holding % cannot become a fund purchase while a withdrawal that is not keyed by a fund draws on it',
      new.transaction_id using errcode = 'check_violation';
  end if;

  -- RE-PRICING one: this row's price is the rate a legacy child's units are DERIVED
  -- at (parent units x principal / parent amount, lib/withdrawalProgress), so moving
  -- it rewrites what the dashboard takes out of the bucket for a row nothing
  -- re-measures. Only children that are actually derived from it are affected: one
  -- that RECORDS a positive units_withdrawn is read as written, whatever this
  -- purchase later costs, so it must not freeze an ordinary edit.
  if old.amount_vnd is distinct from new.amount_vnd or old.units is distinct from new.units then
    -- What the RATE does to each derived child, rather than whether the columns
    -- moved: `units x principal / amount` is unchanged by a proportional correction
    -- (50 units / 2,000,000 restated as 100 / 4,000,000 takes exactly the same
    -- quantity out of the bucket), and freezing both columns refused that edit for
    -- no gain. The cap has to hold still too: the derivation is capped at the
    -- purchase's own units, and that cap only ever binds for a child whose
    -- principal exceeds the purchase's cost — so an edit is safe when the rate is
    -- preserved and no derived child is in that position on either side of it.
    v_rate_kept := coalesce(old.units, 0) > 0 and coalesce(old.amount_vnd, 0) > 0
               and coalesce(new.units, 0) > 0 and coalesce(new.amount_vnd, 0) > 0
               and old.units * new.amount_vnd = new.units * old.amount_vnd;

    select coalesce(max(w.principal_withdrawn), 0), count(*)
      into v_max_principal, v_derived_children
      from public.investment_transactions w
     where w.parent_transaction_id = new.transaction_id
       and w.transaction_type = 'withdrawal'
       and (w.asset_type is distinct from 'fund' or w.fund_id is null)
       and coalesce(w.units_withdrawn, 0) <= 0;

    if v_derived_children > 0
       and not (v_rate_kept
                and v_max_principal <= least(coalesce(old.amount_vnd, 0), coalesce(new.amount_vnd, 0))) then
      raise exception 'withdrawal invariant: fund purchase % cannot change the rate a withdrawal that is not keyed by a fund derives its units at',
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
  before update of transaction_type, asset_type, fund_id, amount_vnd, units
  on public.investment_transactions
  for each row
  when (new.transaction_type = 'investment')
  execute function public.enforce_parent_not_fund_under_withdrawals();
