-- A new fund sale is measured against every claim on its bucket (#606).
--
-- The fund branch of this invariant sums the sells it knew about: rows carrying
-- asset_type='fund' + fund_id. #606 gave the same bucket a second kind of claim —
-- a withdrawal parented to one of its purchases, which lib/withdrawalProgress
-- values against the bucket at its recorded units or the capped pro-rata share of
-- the purchase it names.
--
-- 20260803000002 stops new ones being written and 20260803000004 counts them when
-- a bucket is relocated, but an ordinary new SALE was still measured against the
-- fund-keyed sells alone: a legacy 10-unit claim followed by a 45-unit sell fitted
-- inside a 50-unit bucket, and the dashboard then subtracted all 55 and dropped
-- the five units left. One balance means one sum, and this is the last place that
-- was still using the old one.
--
-- Everything else in the function is copied verbatim from 20260730000002.

create or replace function public.check_withdrawal_balance(wd public.investment_transactions)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Clients round units_withdrawn to 4 decimals (parseFloat(u.toFixed(4))), so a
  -- FULL sell can post a hair more than the holding: 50.12345 units becomes
  -- 50.1235. Allow exactly that much and no more, or "sell everything" breaks.
  c_units_epsilon constant numeric := 0.0001;
  v_principal     bigint;
  v_units         numeric;
  v_out_principal bigint;
  v_out_units     numeric;
  v_left          bigint;
  v_left_units    numeric;
  v_parent_type   text;
  v_parent_asset  text;
  -- Purchases in the fund bucket; null outside that branch, which is also how the
  -- allocation rule below knows which kind it is measuring.
  v_rows          int;
  -- The basis a fund sale of these units is allowed to take, and the one đồng of
  -- rounding the proportional split can produce.
  v_expected      numeric;
  -- The bucket's legacy parent-backed claims (#606), summed alongside the
  -- fund-keyed sells because the reader counts both against the same units.
  v_par_units     numeric;
  v_par_principal bigint;
  c_dong_epsilon  constant numeric := 1;
begin
  if wd.transaction_type is distinct from 'withdrawal' then return; end if;

  -- A negative withdrawal runs the ledger backwards: it ADDS to the holding and
  -- banks a credit the next withdrawal can spend (the sums below are signed, and
  -- so is lib/depositValuation's subtraction). Nothing in the schema stops one, so
  -- the invariant does — before anything is measured, since a negative amount
  -- would poison the measurement itself.
  if coalesce(wd.principal_withdrawn, 0) < 0 or coalesce(wd.units_withdrawn, 0) < 0 then
    raise exception 'withdrawal invariant: amounts cannot be negative (principal %, units %)',
      wd.principal_withdrawn, wd.units_withdrawn using errcode = 'check_violation';
  end if;

  -- The branch order is not a preference: it MIRRORS lib/withdrawalProgress, which
  -- keys any row with asset_type='fund' + fund_id by (goal, fund) and ignores its
  -- parent. Measuring such a row against a parent instead would check a balance
  -- nothing draws down — a fat holding in one goal waving through a phantom fund
  -- sell in another, since the API accepts both fields on one row.
  if wd.asset_type = 'fund' and wd.fund_id is not null then
    -- A fund sale is a quantity: without units the overview skips the whole
    -- subtraction (it bails on `wd.units <= 0`) and the holding keeps its value.
    -- The principal is then not a free number — it is the allocation of the
    -- remaining basis for those units, checked at the end of this function.
    if coalesce(wd.units_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a fund sale must record units_withdrawn (got %)',
        wd.units_withdrawn using errcode = 'check_violation';
    end if;

    -- Both sides of the bucket carry `asset_type = 'fund'`, because that is what
    -- the valuation counts: a row whose asset_type was edited off 'fund' keeps its
    -- fund_id (the PUT clears fund_id only when that field is sent) but is valued
    -- as a bank holding, so its units are no longer fund inventory to sell.
    --
    -- Lock the bucket's investment rows before measuring them (see the header):
    -- this is what makes two concurrent sells of the same bucket serialize. Pending
    -- DCA seeds (units is null) are excluded: they carry a planned amount with no
    -- units bought yet, the dashboard never values them, so they hold nothing to
    -- sell. Renewal snapshots are history copies, not holdings.
    perform 1
      from public.investment_transactions t
     where t.user_id = wd.user_id
       and t.fund_id = wd.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from wd.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null
     order by t.transaction_id      -- a stable lock order; concurrent sells can't deadlock
       for update;

    -- ONE authoritative basis: Σ amount_vnd, what the purchases cost. That is
    -- where the number lands — dashboard/overview does
    --   acc.totalInvested -= Σ principal_withdrawn
    -- against exactly this sum, while the NAV cost (Σ units × unit_price, fees
    -- excluded) is reduced by units and only feeds the average entry price.
    --
    -- The sheets used to post a NAV-derived figure into that amount-based
    -- accumulator, reconstructed through the averaged purchasePrice, and this check
    -- grew a tolerance to accommodate it. lib/fundWithdrawal now takes the basis
    -- from the dashboard directly (a full sale takes it exactly), so the two agree
    -- and the tolerance below covers only what rounding can still explain.
    select coalesce(sum(t.amount_vnd), 0), coalesce(sum(t.units), 0), count(*)
      into v_principal, v_units, v_rows
      from public.investment_transactions t
     where t.user_id = wd.user_id
       and t.fund_id = wd.fund_id
       and t.asset_type = 'fund'
       and t.transaction_type = 'investment'
       and t.goal_id is not distinct from wd.goal_id
       and t.renewed_from_transaction_id is null
       and t.units is not null;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.user_id = wd.user_id
       and w.fund_id = wd.fund_id
       and w.asset_type = 'fund'
       and w.transaction_type = 'withdrawal'
       and w.goal_id is not distinct from wd.goal_id
       and w.transaction_id <> wd.transaction_id;   -- measured without itself

    -- The bucket's OTHER kind of claim (#606). A withdrawal parented to a purchase
    -- in this bucket draws on it too — lib/withdrawalProgress values it there, at
    -- its recorded units or the capped pro-rata share of the purchase it names —
    -- and this sum used to ignore it. A legacy 10-unit claim followed by an
    -- ordinary 45-unit sell was accepted against a 50-unit bucket, and the reader
    -- then subtracted all 55 and dropped what was left. Such rows can no longer be
    -- written, but the ones already in the ledger are still claims, and a new sale
    -- has to be measured against what the bucket actually still owes.
    --
    -- `p.units > 0` is the same question the reader asks: a purchase with no units
    -- is no bucket, so its withdrawal sits on the parent axis and is not counted
    -- here (it is measured against that parent instead).
    select coalesce(sum(case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                             else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd)
                        end), 0),
           coalesce(sum(coalesce(w.principal_withdrawn, 0)), 0)
      into v_par_units, v_par_principal
      from public.investment_transactions w
      join public.investment_transactions p
        on p.transaction_id = w.parent_transaction_id
     where w.user_id = wd.user_id
       and w.transaction_type = 'withdrawal'
       and (w.asset_type is distinct from 'fund' or w.fund_id is null)
       and w.transaction_id <> wd.transaction_id
       and p.transaction_type = 'investment'
       and p.asset_type = 'fund'
       and p.fund_id = wd.fund_id
       and p.goal_id is not distinct from wd.goal_id
       and coalesce(p.units, 0) > 0
       and coalesce(p.amount_vnd, 0) > 0;

    v_out_principal := v_out_principal + v_par_principal;
    v_out_units := v_out_units + v_par_units;

  elsif wd.parent_transaction_id is not null then
    -- Bank / gold / stock: one source row. Lock it before measuring it, so two
    -- concurrent withdrawals of the same deposit serialize here.
    select t.amount_vnd, t.units, t.transaction_type, t.asset_type
      into v_principal, v_units, v_parent_type, v_parent_asset
      from public.investment_transactions t
     where t.transaction_id = wd.parent_transaction_id
       and t.user_id = wd.user_id
       for update;
    -- A parent that isn't the writer's own is the ownership trigger's refusal to
    -- make (#474 / #525); staying quiet here keeps that message the one the user
    -- sees instead of a confusing "no balance".
    if not found then return; end if;

    -- A withdrawal is not a holding, so parenting to one invents a balance out of
    -- money that already left. Renewal snapshots ARE valid parents on purpose:
    -- renew and collapse re-parent partial withdrawals onto them, which is how a
    -- renewed deposit stops double-counting them (#585).
    --
    -- A parent that is a FUND purchase is left alone here, though review flagged
    -- it: such a row is ignored by buildWithdrawalMaps (the fund is valued through
    -- the goal/fund map, which never consults parentWdMap), so it is an UNCOUNTED
    -- withdrawal rather than an overdraw — a valuation gap that predates this
    -- change, and one supabase/tests/dca_seeding_heal.test.sql treats as data that
    -- exists (issue #606). Bounding it by the parent's own principal, as below, is
    -- the most this invariant can honestly say about it.
    if v_parent_type is distinct from 'investment' then
      raise exception 'withdrawal invariant: draws on no holding — its parent % is not an investment',
        wd.parent_transaction_id using errcode = 'check_violation';
    end if;

    -- Gold is the one non-fund holding valued by QUANTITY: valueNonFundHolding
    -- prices it as units × gold price and takes its cost basis from amount_vnd. So
    -- a sale must move both, exactly as a fund sell must. Principal alone drops the
    -- basis while every chỉ stays in net worth — P&L inflated and the sold gold
    -- never leaves; units alone removes the metal and leaves its cost behind.
    -- Keyed off the PARENT's type, not the withdrawal's: the row's own asset_type
    -- is nullable and the route lets it be omitted. Bank and stock are unaffected —
    -- their valuation is principal-only, and a deposit has no units to move.
    if v_parent_asset = 'gold' and coalesce(wd.units_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a gold sale must record units_withdrawn (got %)',
        wd.units_withdrawn using errcode = 'check_violation';
    end if;

    -- A withdrawal that records no principal takes nothing out of the holding:
    -- lib/depositValuation subtracts coalesce(principal_withdrawn, 0), so the
    -- deposit keeps its full value while the row claims cash left. A withdrawal
    -- must not be valid merely because the number to measure was omitted.
    if coalesce(wd.principal_withdrawn, 0) <= 0 then
      raise exception 'withdrawal invariant: a withdrawal from holding % must record a positive principal_withdrawn (got %)',
        wd.parent_transaction_id, wd.principal_withdrawn using errcode = 'check_violation';
    end if;

    select coalesce(sum(w.principal_withdrawn), 0), coalesce(sum(w.units_withdrawn), 0)
      into v_out_principal, v_out_units
      from public.investment_transactions w
     where w.parent_transaction_id = wd.parent_transaction_id
       and w.transaction_type = 'withdrawal'
       -- Same precedence as the branch above, applied to the OTHER rows: a sibling
       -- that is keyed by a fund draws on that bucket, not on this parent, so
       -- counting it here too would charge it twice and make an ordinary later
       -- withdrawal of this deposit look like an overdraw.
       --
       -- coalesce, because asset_type is nullable and the route lets a caller omit
       -- it: written bare, the predicate is NULL for a row with a fund_id and no
       -- asset_type, which DROPS it from this sum — while buildWithdrawalMaps
       -- counts that row against the parent (the fund key needs asset_type =
       -- 'fund'). Two full withdrawals of one deposit both passed that way.
       and not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
       and w.transaction_id <> wd.transaction_id;

  else
    -- Nothing identifiable to draw down. A row taking principal or units out of no
    -- holding at all is not a withdrawal — buildWithdrawalMaps files it under
    -- neither key, so it subtracts from nothing while the record claims cash left.
    -- Reachable by editing a fund sell's asset_type off 'fund' (the fund_id stays,
    -- but the row leaves the fund bucket), which is why asset_type fires the
    -- trigger: running is not enough, the new shape has to be refused.
    if coalesce(wd.principal_withdrawn, 0) > 0 or coalesce(wd.units_withdrawn, 0) > 0 then
      raise exception 'withdrawal invariant: draws on no holding — it has neither a parent transaction nor a fund'
        using errcode = 'check_violation';
    end if;
    -- Carrying neither delta leaves nothing to measure, and exactly ONE kind of row
    -- is allowed to be in that state: a held-for-merge settlement whose source is
    -- not recorded yet (#588 makes them source-backed). The exception is for that
    -- pool, so nothing else may wear it — an ordinary withdrawal has to name what it
    -- draws on, or it is cash leaving no holding at all. held_for_merge is in the
    -- trigger's UPDATE OF list too, so an allowed held row cannot become an
    -- ordinary one by dropping the flag.
    if not wd.held_for_merge then
      raise exception 'withdrawal invariant: draws on no holding — only a held-for-merge settlement may omit its source'
        using errcode = 'check_violation';
    end if;
    return;
  end if;

  -- What the holding has left, after everything already taken out of it.
  v_left := coalesce(v_principal, 0) - v_out_principal;
  v_left_units := coalesce(v_units, 0) - v_out_units;

  -- Quantity bound, for whichever kinds carry units.
  if coalesce(wd.units_withdrawn, 0) > 0 then
    -- The tolerance rounds a real balance; it does not create one. Applied to an
    -- empty holding it would hand every sold-out bucket 0.0001 units it never had.
    if wd.units_withdrawn > v_left_units + (case when v_left_units > 0 then c_units_epsilon else 0 end) then
      raise exception 'withdrawal invariant: % units exceeds the remaining balance of % units on this holding',
        wd.units_withdrawn, v_left_units using errcode = 'check_violation';
    end if;
  end if;

  if v_rows is not null or v_parent_asset = 'gold' then
    -- ANY quantity-valued holding — a fund bucket, or gold — has its principal
    -- BOUND TO THE UNITS, not merely capped beside them. Capping the two
    -- independently let a sale of 1 unit out of 100 claim the whole basis and leave
    -- 99 units with none, which corrupts every later sale's allocation and the P&L,
    -- and eventually makes the rest unsellable for lack of basis. Gold behaves the
    -- same way: valueNonFundHolding prices it units × market and takes its basis
    -- from amount_vnd.
    --
    -- One allocation rule, shared with lib/fundWithdrawal and lib/goldWithdrawal and
    -- matching how the dashboard itself reduces a holding: a sale of ALL the
    -- remaining units takes the remaining basis exactly, and a partial sale takes
    -- its units-proportional share of it. ONE rounding rule: the two sides may
    -- differ by at most a đồng, which is what rounding a proportional slice can
    -- produce.
    if wd.units_withdrawn >= v_left_units - c_units_epsilon then
      v_expected := v_left;
    else
      v_expected := round(wd.units_withdrawn * v_left / v_left_units);
    end if;
    if abs(coalesce(wd.principal_withdrawn, 0) - v_expected) > c_dong_epsilon then
      raise exception 'withdrawal invariant: a sale of % units out of % must take % of the % basis, not %',
        wd.units_withdrawn, v_left_units, v_expected, v_left, wd.principal_withdrawn
        using errcode = 'check_violation';
    end if;

  elsif coalesce(wd.principal_withdrawn, 0) > 0 then
    -- Non-fund: the principal is the user's own figure (the amount they withdrew),
    -- bounded by what the holding still holds.
    if wd.principal_withdrawn > v_left then
      raise exception 'withdrawal invariant: % exceeds the remaining balance of % on this holding',
        wd.principal_withdrawn, v_left using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

comment on function public.check_withdrawal_balance(public.investment_transactions) is
  'Raises when a withdrawal/sell would take more principal or units than its holding still has. Measured under a lock on the source, so concurrent sells cannot both pass (#587).';

-- Postgres grants EXECUTE on a new function to PUBLIC, and this one is SECURITY
-- DEFINER — so left open it is an oracle: call it with a hand-built row naming
-- someone else's holding, and the refusal message reports that holding's exact
-- remaining principal or units, RLS bypassed, taking row locks on the way. It is
-- the triggers' helper and nothing else's; they call it as the definer, so they
-- keep working without these grants.
revoke all on function public.check_withdrawal_balance(public.investment_transactions) from public;
revoke all on function public.check_withdrawal_balance(public.investment_transactions) from anon, authenticated;

