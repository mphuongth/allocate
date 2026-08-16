-- A fund bucket counts only its OWN owner's purchases, on both sides (#668).
--
-- The bucket's two halves disagreed. The BASIS required the purchase to belong to
-- the writer:
--
--   from public.investment_transactions t
--  where t.user_id = wd.user_id      -- ← owner required
--    and t.fund_id = wd.fund_id
--
-- while the legacy parent-backed claims (#606) required the CLAIM's owner to match
-- and never the purchase's — the purchase was reached through `p.fund_id`:
--
--   from public.investment_transactions w
--   join public.investment_transactions p on p.transaction_id = w.parent_transaction_id
--  where w.user_id = wd.user_id      -- ← claim's owner required
--    and p.fund_id = wd.fund_id      -- ← purchase reached by fund, not by owner
--
-- So on a legacy row carrying another user's fund, the cross-owner purchase was
-- left out of what the bucket HOLDS while a claim parented to it was still charged
-- against it:
--
--   A owns fund F. A's own purchase: 100 units. A legacy purchase owned by B,
--   carrying A's fund and goal: 50 units. A's claim of 10 units on B's purchase.
--   A then sells 95 of A's own 100 units.
--     → withdrawal invariant: 95 units exceeds the remaining balance of 90 units
--
-- ─── Which way it is wrong, settled by probing the reader ────────────────────
--
-- #668 left this open: the invariant might be mirroring an asymmetry the dashboard
-- has, in which case it deserved a comment rather than a change. It is not.
-- lib/withdrawalProgress is fed by a USER-SCOPED query, so B's purchase is not
-- among the rows buildWithdrawalMaps is given at all. Probed with A's rows and that
-- claim:
--
--   fundWdMap:   []
--   parentWdMap: [["b-buy", { principal: 10000000, units: 10 }]]
--
-- `fundParent` is undefined, so the claim lands on the PARENT axis under a holding
-- A does not have, where nothing reads it. A's bucket is not reduced by one unit.
--
-- The invariant was therefore not mirroring the reader — it was stricter than it,
-- and the price is the shape above: a legitimate 95-unit sale of a 100-unit holding
-- refused, naming a balance of 90 units the user cannot reconcile against anything
-- on screen. Their dashboard shows 100 units and no claim against them.
--
-- ─── What the predicate does NOT weaken ──────────────────────────────────────
--
-- The bound on the user's own side is untouched: A selling more than A's own
-- purchases hold is still refused, and the test suite stands on it one line after
-- the sale above. What is dropped is a claim measured against a balance it was
-- never part of. Symmetrically, B's own sale of B's own 50 units stops being
-- reduced by A's claim — the same fix seen from the other end.
--
-- Reachable only through legacy data: enforce_fk_ownership (20260722000004) refuses
-- a cross-owner parent at write time, and withdrawal_ledger_audit now names the rows
-- already in the ledger (`parent_belongs_to_another_user`, #667). This makes the
-- three agree — the audit reports the shape, the invariant stops charging for it,
-- and withdrawal_ledger_replay (re-stated below) mirrors the invariant as it must.
--
-- Everything else in the function is copied verbatim from 20260803000005.

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
       -- The PURCHASE's owner too, not just the claim's (#668). Without it the
       -- basis sum above (which does require `t.user_id = wd.user_id`) and this one
       -- measured different buckets, and a claim on a cross-owner purchase was
       -- charged against units it was never backed by. lib/withdrawalProgress does
       -- not count it either — its query is user-scoped, so that purchase is not
       -- among the rows it indexes and the claim stays on the parent axis.
       and p.user_id = wd.user_id
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


-- ── the same correction on the source side ──────────────────────────────────
--
-- check_fund_bucket_solvent measures the bucket when a purchase is EDITED,
-- relocated or deleted, and it carries its own copy of the same two sums with the
-- same asymmetry. Leaving it would make an edit refuse what a sale now allows —
-- one bucket, two answers, which is the thing #606 and #608 both exist to prevent.
-- Verbatim from 20260804000001 apart from the predicate.
create or replace function public.check_fund_bucket_solvent(p_user uuid, p_fund uuid, p_goal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_units      numeric;
  v_out_units  numeric;
  v_basis      bigint;
  v_out_basis  bigint;
  v_par_units  numeric;
  v_par_basis  bigint;
  v_key        bigint;
  -- One đồng per sale, for the reason the parent axis needs it: the proportional
  -- allocation is checked per sale with no running total and no carve-out once the
  -- remaining basis rounds to nothing, so a 1 đồng / 5 unit purchase legally
  -- carries three 1-đồng sales. A flat đồng refused every later edit of such a
  -- bucket, including one that only GREW the purchase. Units stay flat: that bound
  -- withholds its epsilon at zero, so it cannot accumulate.
  v_sales      int;
  v_par_count  int;
begin
  v_key := pg_catalog.hashtextextended(
    p_user::text || ':' || p_fund::text || ':' || coalesce(p_goal::text, ''), 0);
  if not pg_catalog.pg_try_advisory_xact_lock(v_key) then
    -- Someone else is measuring this bucket. Waiting only helps if the sums below
    -- will then be read fresh, which is a READ COMMITTED promise (see the header).
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'withdrawal invariant: this fund bucket is being edited concurrently and cannot be measured against a frozen snapshot — retry the transaction'
        using errcode = 'serialization_failure';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(v_key);
  end if;

  select coalesce(sum(t.units), 0), coalesce(sum(t.amount_vnd), 0)
    into v_units, v_basis
    from public.investment_transactions t
   where t.user_id = p_user and t.fund_id = p_fund and t.asset_type = 'fund'
     and t.transaction_type = 'investment'
     and t.goal_id is not distinct from p_goal
     and t.renewed_from_transaction_id is null
     and t.units is not null;

  select coalesce(sum(w.units_withdrawn), 0), coalesce(sum(w.principal_withdrawn), 0), count(*)
    into v_out_units, v_out_basis, v_sales
    from public.investment_transactions w
   where w.user_id = p_user and w.fund_id = p_fund and w.asset_type = 'fund'
     and w.transaction_type = 'withdrawal'
     and w.goal_id is not distinct from p_goal;

  -- The legacy claims, priced the way the reader prices them: recorded units when
  -- there are any, the capped pro-rata share of the named purchase when there are
  -- not. Keyed by the PURCHASE's goal, because that is the bucket it draws on.
  select coalesce(sum(case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                           else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd)
                      end), 0),
         coalesce(sum(coalesce(w.principal_withdrawn, 0)), 0), count(*)
    into v_par_units, v_par_basis, v_par_count
    from public.investment_transactions w
    join public.investment_transactions p
      on p.transaction_id = w.parent_transaction_id
   where w.user_id = p_user
     and w.transaction_type = 'withdrawal'
     and (w.asset_type is distinct from 'fund' or w.fund_id is null)
     and p.transaction_type = 'investment'
     and p.asset_type = 'fund'
     -- Same predicate, same reason as the sale side above (#668): the basis sum
     -- this is compared against is `t.user_id = p_user`, so reaching the purchase
     -- by fund alone measured a claim against units the bucket was never counted
     -- to hold.
     and p.user_id = p_user
     and p.fund_id = p_fund
     and p.goal_id is not distinct from p_goal
     and coalesce(p.units, 0) > 0
     and coalesce(p.amount_vnd, 0) > 0;

  v_out_units := v_out_units + v_par_units;
  v_out_basis := v_out_basis + v_par_basis;
  -- Deliberately NOT gated on the bucket still holding something, unlike the
  -- parent axis. The flat đồng this replaces was ungated too, and a purchase-less
  -- bucket is a real state a relocation can leave (#587) — withdrawal_ledger_audit
  -- has a fixture standing on exactly that tolerance, and REPORTS such a bucket
  -- rather than having the invariant refuse it. This change makes the allowance
  -- per sale instead of flat; tightening the empty case is a different decision
  -- and not this issue's to take. The units bound still catches what matters:
  -- emptying a bucket that has sold units is refused there whatever the basis says.
  v_sales     := v_sales + v_par_count;

  -- The units epsilon is WITHHELD when the bucket holds none, the same carve-out
  -- check_withdrawal_balance makes for its own: it forgives a client's rounding of
  -- a real balance, it does not conjure one. Flat, it let a 0.0001-unit purchase
  -- backing a 0.0001-unit sale be edited to zero units — the purchase then leaves
  -- the fund accumulator and is valued as an ordinary holding, so its whole
  -- principal reappears on the dashboard while the sale has nothing left to reduce.
  if v_out_units > v_units + (case when v_units > 0 then 0.0001 else 0 end)
     or v_out_basis > v_basis + v_sales then
    raise exception 'withdrawal invariant: this fund bucket would be left owing % units / % of basis it does not hold',
      v_out_units - v_units, v_out_basis - v_basis using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.check_fund_bucket_solvent(uuid, uuid, uuid) is
  'Raises when a (goal, fund) bucket would be left owing more units or basis than its purchases hold, under a lock on the bucket so two concurrent edits of it cannot both pass (#587, #606, #608).';

revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from public;
revoke all on function public.check_fund_bucket_solvent(uuid, uuid, uuid) from anon, authenticated;


-- ── and the replay, which mirrors the invariant by contract ─────────────────
--
-- PR #666 gave this view NO same-owner test on the purchase, with the reasoning
-- inline: the invariant did not have one, and a view whose contract is to report
-- what the database enforces may not carry a predicate the database lacks. That
-- reasoning is unchanged and its conclusion now points the other way — the
-- invariant HAS the predicate as of this migration, so the replay takes it too.
-- supabase/tests/withdrawal_ledger_replay.test.sql had a fixture standing on the
-- old behaviour, exactly so this could not be changed on one side only; it moves
-- with this.
-- Verbatim from 20260814000002 apart from that predicate and its comment.
create or replace view public.withdrawal_ledger_replay
with (security_invoker = true) as
-- RECURSIVE for the `reach` CTE alone, which walks the subsets of a key's events.
with recursive wd as (
  select w.transaction_id, w.user_id, w.goal_id, w.fund_id, w.parent_transaction_id,
         w.principal_withdrawn, w.units_withdrawn, w.created_at, w.updated_at,
         -- The same branch precedence as check_withdrawal_balance and
         -- lib/withdrawalProgress: asset_type='fund' + fund_id wins, and such a row
         -- draws on its (goal, fund) bucket whatever parent it also names.
         coalesce(w.asset_type = 'fund' and w.fund_id is not null, false) as fund_keyed
    from public.investment_transactions w
   where w.transaction_type = 'withdrawal'
),

-- ── the ledger as a sequence of events, per balance key ──────────────────────
-- Two kinds of key, exactly the two the invariant resolves to:
--   'p:<id>'          one source row — bank, gold, stock
--   'f:<fund>:<goal>' a fund bucket, which a sell draws on with no parent at all
--
-- A credit adds to the balance, a debit takes from it, and the running sum of
-- everything BEFORE a debit is the state that debit was measured against.
events as (
  -- The opening balance of a parent-backed holding. Sorted at -infinity rather
  -- than at its own created_at, because a source is not an event in its holding's
  -- history — check_withdrawal_balance reads its amount_vnd and units wholesale,
  -- with no interleaving, and every claim parented to it is measured against that.
  -- Ordering it by created_at would also invert the one case that matters: renewal
  -- re-parents a deposit's partial withdrawals onto a history snapshot written
  -- AFTER them (#585), so the source would sort last and every legal claim on it
  -- would replay against an empty holding.
  select p.user_id,
         'p:' || p.transaction_id::text        as balance_key,
         p.transaction_id                      as holding,
         null::uuid                            as fund_id,
         p.goal_id                             as goal_id,
         -- Gold is the one non-fund holding valued by QUANTITY, so its sales follow
         -- the proportional allocation rather than the outright principal cap.
         (p.asset_type = 'gold')               as quantity_valued,
         '-infinity'::timestamptz              as ord_at,
         0                                     as ord_kind,
         p.transaction_id                      as ord_id,
         false                                 as is_debit,
         false                                 as judge_here,
         -- A credit claims nothing, so there is no shape for the invariant to
         -- refuse. Only a DEBIT can be shape-invalid, and only those quarantine.
         true                                  as shape_ok,
         null::uuid                            as row_id,
         coalesce(p.amount_vnd, 0)::numeric    as d_basis,
         coalesce(p.units, 0)::numeric         as d_units,
         null::numeric                         as took_principal,
         null::numeric                         as took_units,
         (p.updated_at > p.created_at)         as touched,
         null::uuid                            as depends_on
    from public.investment_transactions p
   where p.transaction_type = 'investment'
     and exists (select 1 from wd w
                  where w.parent_transaction_id = p.transaction_id and not w.fund_keyed
                    and w.user_id = p.user_id)

  union all
  select w.user_id, 'p:' || w.parent_transaction_id::text, w.parent_transaction_id, null, w.goal_id,
         (pa.asset_type = 'gold'),
         w.created_at, 1, w.transaction_id, true,
         -- Judged here UNLESS its shape is already condemned. The invariant demands
         -- a positive principal from any parent-backed claim and refuses one
         -- without ever reaching the allocation rule, and withdrawal_ledger_audit
         -- names that row `withdrawal_missing_principal`. Judging it anyway makes
         -- the replay report the same row a second time under a WORSE name: a
         -- gold sale recording no principal comes out as "it should have taken
         -- 10,000,000 đồng, it took 0", which describes a misallocation where the
         -- defect is that no principal was recorded at all. The two views are
         -- advertised as complements, and a complement does not restate its
         -- partner's finding in vaguer words. It still consumes the balance, and
         -- it stays freely placeable in the ordering search — a row that could
         -- never have been written cannot be used to prove anything about its
         -- neighbours.
         -- A NEGATIVE amount is condemned by the screen too (`negative_amounts`),
         -- and it is the same mistake to restate it here: principal 150 of a 100
         -- holding with units -1 came out as a plain overdraw, which says nothing
         -- about the sign that makes the row impossible. It is also the one shape
         -- that runs the ledger BACKWARDS — a negative delta ADDS to the holding
         -- and banks a credit later rows can spend — so judging the rows around it
         -- would measure them against a balance the invariant would never have
         -- allowed to exist.
         -- judge_here and shape_ok are the SAME question on this axis, asked twice
         -- because they answer different ones downstream: whether to grade this row,
         -- and whether its numbers may be trusted as the balance for its neighbours.
         -- The gold clause is the invariant's ("a gold sale must record
         -- units_withdrawn"); it never produced a finding here, but such a row still
         -- eats basis, so it has to quarantine.
         coalesce(w.principal_withdrawn, 0) > 0
           and coalesce(w.units_withdrawn, 0) >= 0
           and (pa.asset_type is distinct from 'gold' or coalesce(w.units_withdrawn, 0) > 0),
         coalesce(w.principal_withdrawn, 0) > 0
           and coalesce(w.units_withdrawn, 0) >= 0
           and (pa.asset_type is distinct from 'gold' or coalesce(w.units_withdrawn, 0) > 0),
         w.transaction_id,
         -coalesce(w.principal_withdrawn, 0), -coalesce(w.units_withdrawn, 0),
         coalesce(w.principal_withdrawn, 0), coalesce(w.units_withdrawn, 0),
         (w.updated_at > w.created_at), null::uuid
    from wd w
    join public.investment_transactions pa on pa.transaction_id = w.parent_transaction_id
   where not w.fund_keyed
     -- A parent that is not an investment invents a balance out of money that
     -- already left; withdrawal_ledger_audit calls that by name, and replaying it
     -- would only restate the same row less clearly.
     and pa.transaction_type = 'investment'
     -- And it has to be the writer's OWN holding, which is the same predicate
     -- check_withdrawal_balance uses before it reads a balance at all — it finds
     -- nothing and returns quietly, leaving ownership to the trigger whose refusal
     -- it is (#474 / #525). Without this the two sides land in different partitions
     -- (the holding under its owner, the claim under the claimant) and the claim
     -- replays against an opening balance of zero, which reads as a pristine
     -- overdraw of a holding that is in fact untouched.
     and pa.user_id = w.user_id

  union all
  -- The bucket's OTHER kind of claim (#606). A withdrawal parented to a fund
  -- PURCHASE is not fund-keyed, so it is measured on the parent axis above — but
  -- 20260803000005 also charges it against that purchase's (goal, fund) bucket
  -- when the next sale is measured, because lib/withdrawalProgress values it
  -- there. Leaving it out of the bucket made the replay miss exactly the overdraw
  -- that migration exists to refuse: a legacy 10-unit claim on a 50-unit purchase
  -- followed by a 45-unit sell replays as 45 of 50 and reports clean.
  --
  -- It is a DEBIT here and not a judged one: the invariant never measures such a
  -- row against the bucket, only counts it. Its verdict is the parent axis's.
  --
  -- Every predicate below is that function's, including the derived units for a
  -- claim that records none, and `p.units > 0` — a purchase with no units is no
  -- bucket, so its claim stays on the parent axis alone.
  select w.user_id,
         'f:' || p.fund_id::text || ':' || coalesce(p.goal_id::text, ''),
         null, p.fund_id, p.goal_id, true,
         -- Not judged here, and NOT quarantining either: 20260803000005's bucket
         -- query sums this row's numbers exactly as they stand, whatever shape they
         -- are in. They are not contamination — on this axis they are the balance.
         w.created_at, 1, w.transaction_id, true, false, true, w.transaction_id,
         -coalesce(w.principal_withdrawn, 0),
         -case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
               else least(p.units, p.units * coalesce(w.principal_withdrawn, 0) / p.amount_vnd) end,
         null, null,
         -- The PARENT's edits count as this event's too, because this event's units
         -- are derived from the parent's current units and amount_vnd (see the
         -- expression above) — so editing the purchase silently restates how much
         -- of the bucket this claim took. Usually the purchase is a credit on this
         -- same key and its own touched flag would carry, but not always: a
         -- cross-owner purchase is partitioned under ITS owner, and a renewal
         -- snapshot is no part of the bucket at all, while 20260803000005 counts
         -- claims on both. Probed — a claim deriving 20 units, a legal 40-unit sale
         -- against that, then the parent re-priced so the claim derives 10: every
         -- row pristine, and the sale reported as a proven violation.
         (w.updated_at > w.created_at or p.updated_at > p.created_at),
         -- The one order the ledger DOES record. A claim parented to a purchase
         -- cannot have been written before that purchase existed: the foreign key
         -- would have refused it, and the invariant finds the claim by joining to
         -- it. Unlike created_at, that is a fact about the schema rather than a
         -- guess about clocks, so the search must honour it.
         p.transaction_id
    from wd w
    join public.investment_transactions p on p.transaction_id = w.parent_transaction_id
   where not w.fund_keyed
     and p.transaction_type = 'investment'
     and p.asset_type = 'fund'
     and p.fund_id is not null
     and coalesce(p.units, 0) > 0
     and coalesce(p.amount_vnd, 0) > 0
     -- The purchase's owner, matching the invariant's bucket query as of #668. It
     -- deliberately did NOT have this until now, and the note PR #666 left here is
     -- worth keeping in substance: this view's contract is to report what the
     -- database actually enforces, so it may not carry a predicate the database
     -- lacks — adding one then dropped a claim the invariant charges, and a bucket
     -- the invariant refuses replayed clean. The predicate exists on both sides now
     -- (20260816000003 puts it in check_withdrawal_balance and
     -- check_fund_bucket_solvent alike), so the same rule that kept it out then
     -- requires it here. If the invariant's ever moves again, this moves with it —
     -- the replay's own test suite has a fixture standing on the pairing.
     and p.user_id = w.user_id

  union all
  -- A fund bucket's purchases DO interleave: the invariant sums whatever is in the
  -- bucket at the moment of the sell, so a purchase made later is not part of that
  -- sum. The exclusions mirror the invariant's own — a pending DCA seed (units
  -- null) holds nothing sellable, and a renewal snapshot is a history copy.
  select t.user_id,
         'f:' || t.fund_id::text || ':' || coalesce(t.goal_id::text, ''),
         null, t.fund_id, t.goal_id, true,
         t.created_at, 0, t.transaction_id, false, false, true, t.transaction_id,
         coalesce(t.amount_vnd, 0), coalesce(t.units, 0), null, null,
         (t.updated_at > t.created_at), null::uuid
    from public.investment_transactions t
   where t.transaction_type = 'investment'
     and t.asset_type = 'fund'
     and t.fund_id is not null
     and t.units is not null
     and t.renewed_from_transaction_id is null

  union all
  select w.user_id,
         'f:' || w.fund_id::text || ':' || coalesce(w.goal_id::text, ''),
         null, w.fund_id, w.goal_id, true,
         w.created_at, 1, w.transaction_id, true,
         -- Same negative-amount carve-out as the parent axis, for the same reason:
         -- the screen names it and this view would only restate it worse — a sell
         -- of 50 units recording MINUS 500 đồng came out as "it should have taken
         -- 500 đồng, it took -500", which reads as a misallocation rather than as
         -- the impossible sign it is. No positive-principal rule here, though:
         -- unlike the parent axis a fund sell may legitimately take nothing, since
         -- a slice worth less than half a đồng rounds to zero.
         -- Same pair as the parent axis. The units clause is the invariant's ("a
         -- fund sale must record units_withdrawn") and, like gold's, it never
         -- produced a finding — but such a row still eats basis, so it quarantines.
         coalesce(w.principal_withdrawn, 0) >= 0 and coalesce(w.units_withdrawn, 0) > 0,
         coalesce(w.principal_withdrawn, 0) >= 0 and coalesce(w.units_withdrawn, 0) > 0,
         w.transaction_id,
         -coalesce(w.principal_withdrawn, 0), -coalesce(w.units_withdrawn, 0),
         coalesce(w.principal_withdrawn, 0), coalesce(w.units_withdrawn, 0),
         (w.updated_at > w.created_at),
         -- A fund sell ignores its parent for the BALANCE — the bucket is what it
         -- draws on — but the foreign key still proves that parent existed when the
         -- sell was written. Where the parent is a purchase in this same bucket that
         -- is a real ordering fact, and without it the search invents the one
         -- history that excuses the sell: its own parent purchase placed after it.
         w.parent_transaction_id
    from wd w
   where w.fund_keyed
),

-- ── the state each row was written against ──────────────────────────────────
-- now() is fixed for a whole transaction, so every row a single RPC writes shares
-- one created_at and there is no order between them to read. Credits are therefore
-- sorted before debits at the same instant, which is the only reading under which
-- such a transaction could have passed the invariant in the first place: a
-- purchase and the sell of it written together must have gone in that order.
--
-- That order is what the replay REPORTS against. It is not what it proves from —
-- see the ordering search below, which assumes no order at all.
-- A debit the invariant would have refused OUTRIGHT contributes NOTHING here: not
-- a verdict, and not a delta either. The row could not have been written, so no
-- legal history of this holding contains it, and the balances its neighbours have
-- to answer for are the ones the holding would show without it.
--
-- Leaving the delta in was wrong in both directions. It invented balances that
-- convicted innocent rows — a 40,000,000 / 4 unit gold holding with a no-principal
-- 1-unit claim replayed the perfectly ordinary 1-unit / 10,000,000 sale after it
-- against 40,000,000 / 3. And because these deltas are SIGNED, it also hid real
-- ones: a 100 đồng holding with a -100 withdrawal and then a 150 withdrawal
-- replayed the 150 against 200 and said nothing, while the screen's aggregate came
-- to 50 and said nothing either. That overdraw was reported by no view at all,
-- which is the exact silence this family exists to break.
--
-- The key is still marked, because the row is still there and an operator reading
-- a finding on this holding needs to know a broken row sits beside it — see the
-- sentence appended in the detail below.
state as (
  select e.*,
         coalesce(sum(case when e.is_debit and not e.shape_ok then 0 else e.d_basis end)
                  over w_prev, 0) as rem_basis,
         coalesce(sum(case when e.is_debit and not e.shape_ok then 0 else e.d_units end)
                  over w_prev, 0) as rem_units,
         bool_or(e.touched)      over w_key      as key_touched,
         count(*) filter (where e.is_debit) over w_key as claims_on_key,
         -- Where this claim sits in the holding's history, which is the number an
         -- operator needs to find it in the ledger. Counted over the claims alone,
         -- so an interleaved fund purchase does not shift it — and over ALL of
         -- them, including the refused ones, because the operator is counting rows
         -- in a ledger, not events in this view's model of it.
         count(*) filter (where e.is_debit) over w_upto as claim_ordinal,
         -- The events that have to be permuted to decide the key: everything but
         -- the source, which opens the balance rather than happening in it, and
         -- everything the invariant would have refused, which is not part of any
         -- history there is to order.
         count(*) filter (where e.ord_at > '-infinity'
                            and not (e.is_debit and not e.shape_ok)) over w_key as movable,
         bool_or(e.is_debit and not e.shape_ok) over w_key as key_contaminated
    from events e
  window
    w_key  as (partition by e.user_id, e.balance_key),
    w_prev as (partition by e.user_id, e.balance_key
               order by e.ord_at, e.ord_kind, e.ord_id
               rows between unbounded preceding and 1 preceding),
    w_upto as (partition by e.user_id, e.balance_key
               order by e.ord_at, e.ord_kind, e.ord_id
               rows between unbounded preceding and current row)
),

-- ── the invariant's own transition rules, re-run ────────────────────────────
-- Same three questions check_withdrawal_balance asks, same two constants, asked of
-- the balance as it stood rather than of the balance as it ended.
judged as (
  select s.*,
         case when s.rem_units > 0 and s.took_units < s.rem_units - 0.0001
                then round(s.took_units * s.rem_basis / s.rem_units)
              else s.rem_basis end as owed,
         case
           -- Quantity, for whichever kinds carry units. The epsilon rounds a real
           -- balance and does not create one, so an emptied holding is measured
           -- exactly — `case when v_left_units > 0` is the invariant's own wording.
           when s.took_units > 0
            and s.took_units > s.rem_units + case when s.rem_units > 0 then 0.0001 else 0 end
             then 'sale_exceeded_the_units_left'
           -- A quantity-valued holding binds its principal TO the units: a sale of
           -- all that is left takes the remaining basis, a partial sale its
           -- units-proportional share, and the two sides may differ by at most the
           -- đồng that rounding a slice produces.
           when s.quantity_valued and s.took_units > 0 and s.rem_units > 0
            and abs(s.took_principal
                    - case when s.took_units < s.rem_units - 0.0001
                             then round(s.took_units * s.rem_basis / s.rem_units)
                           else s.rem_basis end) > 1
             then 'sale_took_the_wrong_basis'
           -- Bank and stock: the principal is the user's own figure, capped
           -- outright by what the holding still held.
           when not s.quantity_valued and s.took_principal > 0
            and s.took_principal > s.rem_basis
             then 'withdrawal_exceeded_the_balance'
         end as failure
    from state s
   where s.judge_here
),

fails as (
  select j.*, count(*) over (partition by j.user_id, j.balance_key) as fails_on_key
    from judged j
   where j.failure is not null
),

-- ── is there ANY order this key could have been written in? ─────────────────
-- What the replay reports comes from created_at. What it PROVES may not, because
-- created_at is `now()`, which is the transaction's START — and the invariant
-- serializes claims on a lock, so the write order is the lock order. A long
-- transaction can write after a later-starting one:
--
--   A begins 11:06:57 .............................. writes (32 units, 319 đồng)
--   B begins 11:06:59, writes (34, 339), commits
--
-- Both accepted — B against the full 1000 đồng / 100 units, A against the 661/66
-- B left it. Both rows pristine, both timestamps distinct, and in the WRONG order:
-- replayed by created_at the 34-unit row owes 341 and is two đồng out. Reproduced
-- with two sessions against the local stack. No comparison of created_at values
-- rescues that, whatever gap is allowed for, so the ordering is not assumed at all.
--
-- Instead the question #613 actually asks — "no ordering of any history could have
-- produced this row" — is answered directly, and it is cheaper than it looks. The
-- remaining balance after a SET of events does not depend on the order they came
-- in: it is the opening balance plus their deltas, and addition commutes. So this
-- is a search over subsets, not permutations. A subset is reachable when some
-- event in it is legal against the balance the rest of it leaves.
--
-- A key where SOME ordering is legal cannot be called proven, however damning the
-- created_at order looks; it drops to 'review' with the finding intact. Only a key
-- where the full set is unreachable by any route has no legal reading at all.
--
-- The cap is a resource bound, not a tolerance: a key with more than 14 movable
-- events is not searched and reports 'review'. Ordinary holdings are far below it,
-- and only keys that already produced a finding are searched at all — a clean
-- ledger does no work here.
movable as (
  select s.user_id, s.balance_key, s.row_id, s.is_debit, s.judge_here, s.quantity_valued,
         s.d_basis, s.d_units, s.took_principal, s.took_units, s.depends_on,
         (row_number() over (partition by s.user_id, s.balance_key
                             order by s.ord_at, s.ord_kind, s.ord_id) - 1)::int as idx
    from state s
   where s.ord_at > '-infinity'
     -- Out of the search for the same reason it is out of the running balance:
     -- a row the invariant would have refused is not part of any history there is
     -- to order, so it neither takes a position nor carries a delta into one.
     and not (s.is_debit and not s.shape_ok)
     and exists (select 1 from fails f
                  where f.user_id = s.user_id and f.balance_key = s.balance_key)
),
-- The claim-to-purchase dependency, resolved to the bit that purchase occupies.
-- Null when the purchase is not an event on this key at all — a renewal snapshot,
-- say, which the invariant still counts the claim against but which is no part of
-- the bucket — and the claim is then unconstrained, which is the cautious way to
-- be wrong.
movable_dep as (
  select m.*, buy.idx as dep_idx
    from movable m
    left join movable buy
      on buy.user_id = m.user_id
     and buy.balance_key = m.balance_key
     and buy.row_id = m.depends_on
),
opening as (
  select s.user_id, s.balance_key,
         -- The source opens a parent-backed holding; a fund bucket opens at zero
         -- and is filled by the purchase events themselves.
         coalesce(sum(s.d_basis) filter (where s.ord_at = '-infinity'), 0) as open_basis,
         coalesce(sum(s.d_units) filter (where s.ord_at = '-infinity'), 0) as open_units,
         max(s.movable)::int as n
    from state s
   where exists (select 1 from fails f
                  where f.user_id = s.user_id and f.balance_key = s.balance_key)
   group by s.user_id, s.balance_key
),
reach as (
  select o.user_id, o.balance_key, 0::bigint as mask,
         o.open_basis as rem_basis, o.open_units as rem_units
    from opening o
   where o.n <= 14
  union
  select r.user_id, r.balance_key, r.mask | (1::bigint << m.idx),
         r.rem_basis + m.d_basis, r.rem_units + m.d_units
    from reach r
    join movable_dep m
      on m.user_id = r.user_id and m.balance_key = r.balance_key
     and (r.mask >> m.idx) & 1 = 0
     -- The purchase a claim names has to have happened already. This is the ONE
     -- ordering fact the ledger actually records: the foreign key would have
     -- refused the claim otherwise.
     and (m.dep_idx is null or (r.mask >> m.dep_idx) & 1 = 1)
   where not m.is_debit
      -- A purchase claims nothing, and a claim the invariant does not measure here
      -- (a bucket's parent-backed claim) is only counted, never judged — so both
      -- may be placed anywhere.
      or not m.judge_here
      -- Otherwise it has to survive the same three questions, against the balance
      -- the rest of this subset leaves.
      or (not (m.took_units > 0
               and m.took_units > r.rem_units + case when r.rem_units > 0 then 0.0001 else 0 end)
          and not (m.quantity_valued and m.took_units > 0 and r.rem_units > 0
                   and abs(m.took_principal
                           - case when m.took_units < r.rem_units - 0.0001
                                    then round(m.took_units * r.rem_basis / r.rem_units)
                                  else r.rem_basis end) > 1)
          and not (not m.quantity_valued and m.took_principal > 0
                   and m.took_principal > r.rem_basis))
),
explainable as (
  select distinct r.user_id, r.balance_key
    from reach r
    join opening o on o.user_id = r.user_id and o.balance_key = r.balance_key
   where r.mask = (1::bigint << o.n) - 1
),

-- ── and is THIS row the one that is wrong? ──────────────────────────────────
-- "No ordering of this holding is legal" is a statement about the HOLDING. The
-- finding names a ROW, and those are not the same claim. A pristine 1000 đồng /
-- 100 unit holding with two 50-unit sales each taking 499: either is legal written
-- first (the đồng of rounding covers 499 against 500) and whichever comes second
-- owes the whole 501 that is left, so no complete ordering exists — yet neither
-- sale is individually impossible, and calling one of them proven sends an
-- operator to correct a row that may be the innocent one.
--
-- So the row is asked about itself: is there ANY state this holding could legally
-- have been in, without this row, where this row would have been accepted? The
-- reachable states are already computed above, so this is a scan over them. Legal
-- somewhere means not proven, whatever the holding as a whole says.
--
-- This is strictly stronger than the holding-level test and replaces it: a holding
-- with a legal ordering puts every one of its rows in a legal position, so nothing
-- provable at row level can survive there. What the holding-level result still
-- earns is a SENTENCE — the detail says the holding has no legal reading even when
-- no single row can be blamed for it, which is the true and useful thing to tell
-- an operator looking at a set of rows that cannot all be right.
row_rescued as (
  select distinct f.user_id, f.balance_key, f.row_id
    from fails f
    join movable_dep m
      on m.user_id = f.user_id and m.balance_key = f.balance_key and m.row_id = f.row_id
    join reach r
      on r.user_id = f.user_id and r.balance_key = f.balance_key
     and (r.mask >> m.idx) & 1 = 0
     and (m.dep_idx is null or (r.mask >> m.dep_idx) & 1 = 1)
   where not (f.took_units > 0
              and f.took_units > r.rem_units + case when r.rem_units > 0 then 0.0001 else 0 end)
     and not (f.quantity_valued and f.took_units > 0 and r.rem_units > 0
              and abs(f.took_principal
                      - case when f.took_units < r.rem_units - 0.0001
                               then round(f.took_units * r.rem_basis / r.rem_units)
                             else r.rem_basis end) > 1)
     and not (not f.quantity_valued and f.took_principal > 0
              and f.took_principal > r.rem_basis)
)

select distinct on (f.user_id, f.balance_key)
       f.failure::text  as check_name,
       -- Provable only where the replay's premise holds: nothing on this key was
       -- touched after it was written, so these rows ARE what was measured; the key
       -- was small enough to search; and THIS ROW had no legal position in it.
       -- Contamination is deliberately NOT a clause here, though it looks like one.
       -- A row the invariant would have refused is out of the balances and out of
       -- the search entirely, so what remains on the key IS the legal ledger and a
       -- finding against it is as sound as any other. Downgrading it because
       -- something else on the holding is broken would throw away a true proof —
       -- and it was a real one: the 150 đồng overdraw hiding behind a -100 đồng row
       -- is only reported because this stays 'violation'. What contamination earns
       -- is the sentence in the detail, not a change of verdict.
       case when f.key_touched
              or f.movable > 14
              or exists (select 1 from row_rescued x
                          where x.user_id = f.user_id and x.balance_key = f.balance_key
                            and x.row_id = f.row_id)
              then 'review' else 'violation' end::text as severity,
       f.user_id,
       f.row_id         as transaction_id,
       f.holding        as parent_transaction_id,
       f.fund_id,
       f.goal_id,
       case f.failure
         when 'sale_exceeded_the_units_left' then
           -- "claim(s)", not "sale(s)": on a fund bucket this count includes the
           -- withdrawals parented to its purchases (#606), which are claims on the
           -- bucket without being sales of it. Counting them is the point — a
           -- legacy claim is often the reason the sale that follows does not fit,
           -- and an operator who cannot see it in the tally goes looking for a
           -- second sale that is not there.
           format('a sale of %s units when the holding had %s units left (%s đồng of basis), %s of %s claim(s) into its history',
                  f.took_units, f.rem_units, f.rem_basis, f.claim_ordinal, f.claims_on_key)
         when 'sale_took_the_wrong_basis' then
           format('a sale of %s units out of the %s units then left, against a %s đồng basis: it should have taken %s đồng, it took %s',
                  f.took_units, f.rem_units, f.rem_basis, f.owed, f.took_principal)
         else
           -- This branch is the parent axis alone, where every claim IS a
           -- withdrawal of the holding and the word can be the exact one.
           format('a withdrawal of %s đồng when the holding had %s đồng left, %s of %s withdrawal(s) into its history',
                  f.took_principal, f.rem_basis, f.claim_ordinal, f.claims_on_key)
       end
       || case when f.fails_on_key > 1
                 then format(' — and %s later row(s) on this holding fail the replay too, measured against a balance this one already made fiction',
                             f.fails_on_key - 1)
               else '' end
       -- The holding-level result, where it says more than the row-level one. Two
       -- 50-unit sales of 1000 đồng / 100 units each taking 499 have no legal
       -- reading between them, and neither one is individually impossible — the
       -- proof is real but it belongs to the pair, so it goes in the sentence
       -- rather than into a severity that would point at one of them.
       || case when not f.key_touched and f.movable <= 14
                and not exists (select 1 from explainable x
                                 where x.user_id = f.user_id and x.balance_key = f.balance_key)
                and exists (select 1 from row_rescued x
                             where x.user_id = f.user_id and x.balance_key = f.balance_key
                               and x.row_id = f.row_id)
                 then '. No ordering of this holding''s claims is legal, so at least one of them is wrong — but this row is not provably the one, since it would have been accepted had it been written earlier'
               else '' end
       -- Said where the operator meets it, because the balances above will not
       -- reconcile against the rows they can see otherwise: one of those rows is
       -- deliberately not in them.
       || case when f.key_contaminated
                 then '. This holding also carries a row check_withdrawal_balance would have refused outright — withdrawal_ledger_audit names it — and it is left out of the balances above, since no legal history of this holding contains it'
               else '' end as detail
  from fails f
 order by f.user_id, f.balance_key, f.ord_at, f.ord_kind, f.ord_id;

comment on view public.withdrawal_ledger_replay is
  'Replays each balance key''s rows against check_withdrawal_balance''s own transition rules and names the first row that could not have been written at its turn. created_at gives the order it REPORTS against; severity is decided by an exhaustive search over orderings, since created_at is transaction-start and records no write order. severity=violation means this row had no legal position in any history of its holding, and nothing on the key was edited after it was written; severity=review means it is worth looking at but not proven — read the detail, which carries the holding-level verdict where that says more. Shape checks belong to withdrawal_ledger_audit; the two are complements (#613).';

-- An operator tool, and there is no screen that reads it. security_invoker means
-- RLS would confine a caller to their own rows anyway, but granting it adds a
-- PostgREST surface for no gain — the same reasoning that revoked
-- withdrawal_ledger_audit in 20260730000003.
revoke all on public.withdrawal_ledger_replay from anon, authenticated;

-- ── and the screen, for the same reason ─────────────────────────────────────
--
-- withdrawal_ledger_audit's `fund_parented` keys a claim into the PURCHASE's
-- (goal, fund) bucket, reached by id with no owner test — so a claim on a
-- cross-owner purchase was aggregated into a bucket under the CLAIMANT's user_id
-- with the other user's fund and goal, and could report that bucket overdrawn for
-- units it never held. With the invariant no longer charging it, such a claim
-- belongs on the parent axis, where `parent_belongs_to_another_user` (#667)
-- already names it — one finding for the row, not a phantom overdraw beside it.
-- Verbatim from 20260816000001 apart from that predicate.
create or replace view public.withdrawal_ledger_audit
with (security_invoker = true) as
with wd as (
  select w.transaction_id, w.user_id, w.goal_id, w.fund_id, w.parent_transaction_id,
         w.asset_type, w.principal_withdrawn, w.units_withdrawn, w.held_for_merge,
         w.investment_date,
         -- The same branch precedence as the invariant and lib/withdrawalProgress:
         -- asset_type='fund' + fund_id wins, and such a row draws on its (goal,
         -- fund) bucket no matter what parent it also names.
         coalesce(w.asset_type = 'fund' and w.fund_id is not null, false) as fund_keyed,
         p.transaction_type as parent_type,
         p.asset_type       as parent_asset,
         -- Who owns the holding this row names. NULL means the parent is not
         -- visible, and under security_invoker that is the same fact said another
         -- way: the FK guarantees the row exists, so a reader who cannot see it is
         -- a reader it does not belong to. Both readings are handled where this is
         -- used, so the finding fires whether the view is run as an operator
         -- (both rows visible, the ids differ) or as the claimant (RLS hides the
         -- parent, and the join leaves this null).
         p.user_id          as parent_user,
         -- The other half of the same bucket (#606): a row parented to a fund
         -- PURCHASE draws on that purchase's (goal, fund) bucket too, so the
         -- aggregates below have to add it there — and NOT to the parent, or one
         -- claim would be measured against two balances.
         p.fund_id          as parent_fund,
         p.goal_id          as parent_goal,
         p.units            as parent_units,
         p.amount_vnd       as parent_amount,
         -- `p.units > 0` mirrors the reader exactly: lib/dashboardOverview keys a
         -- holding into a fund bucket on `asset_type === 'fund' && tx.units`, so a
         -- purchase with no units (a pending DCA seed) or zero units is valued as an
         -- ordinary holding and its withdrawal stays on the parent axis.
         -- The inner test is coalesced BEFORE the negation, like fund_keyed above:
         -- asset_type is nullable, so `w.asset_type = 'fund'` on a row with a
         -- retained fund_id and no asset_type is NULL, and `not NULL` is NULL —
         -- which would file the row as neither fund-keyed nor fund-parented while
         -- the reader charges the parent's bucket for it.
         -- And the purchase's OWNER (#668). Reached by id alone, a claim on a
         -- cross-owner purchase was keyed into a bucket filed under the CLAIMANT's
         -- user_id but carrying the other user's fund and goal — a bucket that can
         -- report itself overdrawn for units it never held. The invariant no longer
         -- charges such a claim, and the reader never did (its query is user-scoped,
         -- so the purchase is not among the rows it indexes), so the row belongs on
         -- the parent axis. `parent_belongs_to_another_user` (#667) names it there.
         coalesce(not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
                  and p.transaction_type = 'investment'
                  and p.asset_type = 'fund' and p.fund_id is not null
                  and p.user_id = w.user_id
                  and coalesce(p.units, 0) > 0, false) as fund_parented,
         -- The rows the owner test above newly drops out of `fund_parented`: a
         -- claim on someone else's fund purchase. They belong to NEITHER aggregate,
         -- and saying so needs its own flag.
         --
         -- Not the bucket, because the invariant stopped charging them there
         -- (#668). And not the parent axis either, which is where they would
         -- otherwise fall — unlike the bank/gold/stock case, where a cross-owner
         -- claim IS charged to the holding (the invariant's sibling sum is keyed by
         -- parent_transaction_id alone, which is why `parents` deliberately has no
         -- ownership test and #667 kept it that way). No legal write reaches the
         -- parent axis of a FUND purchase at all: 20260803000002 refuses one
         -- outright — "a fund sale must be keyed by its fund, not parented to
         -- purchase X" — so charging the claim there mirrors no invariant and
         -- invents an overdraw of a holding whose owner cannot even write against
         -- it. Probed: 90 units claimed on a 50-unit purchase reported
         -- `holding_overdrawn` under the PURCHASE's owner, for a row they did not
         -- write and a state they cannot reach.
         --
         -- `parent_belongs_to_another_user` (#667) still names the row, which is the
         -- finding that describes it.
         coalesce(not coalesce(w.asset_type = 'fund' and w.fund_id is not null, false)
                  and p.transaction_type = 'investment'
                  and p.asset_type = 'fund' and p.fund_id is not null
                  and p.user_id is distinct from w.user_id
                  and coalesce(p.units, 0) > 0, false) as fund_parent_not_ours
    from public.investment_transactions w
    left join public.investment_transactions p on p.transaction_id = w.parent_transaction_id
   where w.transaction_type = 'withdrawal'
),
-- One source row: bank, gold, stock. Only holdings that something draws on.
parents as (
  select p.transaction_id, p.user_id, p.goal_id, p.asset_type, p.amount_vnd, p.units,
         sum(coalesce(w.principal_withdrawn, 0)) as out_principal,
         sum(coalesce(w.units_withdrawn, 0))     as out_units,
         count(*)                                as sells
    from public.investment_transactions p
    join wd w on w.parent_transaction_id = p.transaction_id
             and not w.fund_keyed and not w.fund_parented
             -- Still deliberately NOT constrained to the holding's own owner in
             -- general: for a bank/gold/stock parent the invariant's sibling sum is
             -- keyed by parent_transaction_id alone, so a cross-owner claim really
             -- does reduce the balance its OWNER is measured against, and dropping
             -- it here would report a holding sound while the database refuses that
             -- owner's next write (#667). What is excluded is the one shape where no
             -- legal write reaches this axis at all — see `fund_parent_not_ours`.
             and not w.fund_parent_not_ours
   where p.transaction_type = 'investment'
   group by p.transaction_id, p.user_id, p.goal_id, p.asset_type, p.amount_vnd, p.units
),
fund_buys as (
  select t.user_id, t.goal_id, t.fund_id,
         sum(t.amount_vnd) as basis, sum(t.units) as units, count(*) as buys
    from public.investment_transactions t
   where t.transaction_type = 'investment'
     and t.asset_type = 'fund'
     and t.fund_id is not null
     and t.units is not null                       -- pending DCA seeds hold nothing
     and t.renewed_from_transaction_id is null     -- renewal snapshots are history
   group by t.user_id, t.goal_id, t.fund_id
),
fund_sells as (
  -- One bucket, both shapes — measured by what the READER removes, which for a
  -- fund-parented row with no units_withdrawn is a DERIVED quantity: the same
  -- capped pro-rata share of the parent purchase that lib/withdrawalProgress
  -- subtracts. Counting those rows as zero units looked conservative and was not:
  -- a principal-only draw on a 100-unit purchase takes 100 units out of the bucket
  -- in the dashboard, and an audit that scores it as nothing reports a bucket sold
  -- past its units as clean — which is the one thing this check exists to catch.
  select w.user_id,
         case when w.fund_keyed then w.goal_id else w.parent_goal end as goal_id,
         case when w.fund_keyed then w.fund_id else w.parent_fund end as fund_id,
         sum(coalesce(w.principal_withdrawn, 0)) as out_principal,
         -- A recorded ZERO derives like an absent one, exactly as the reader does:
         -- the old parent-backed write path demanded positive units only from a
         -- gold parent, so zero beside a real principal is a shape this data wears,
         -- and coalesce alone would let it slip past the derivation and hide the
         -- units the dashboard removes for it.
         sum(case when w.fund_keyed then coalesce(w.units_withdrawn, 0)
                  when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn
                  when coalesce(w.parent_units, 0) > 0 and coalesce(w.parent_amount, 0) > 0
                    then least(w.parent_units,
                               w.parent_units * coalesce(w.principal_withdrawn, 0) / w.parent_amount)
                  else 0
             end)                                as out_units,
         count(*)                                as sells,
         min(w.transaction_id::text)             as a_sell
    from wd w
   where w.fund_keyed or w.fund_parented
   group by 1, 2, 3
),
fund_buckets as (
  select s.user_id, s.goal_id, s.fund_id, s.out_principal, s.out_units, s.sells, s.a_sell,
         coalesce(b.basis, 0) as basis, coalesce(b.units, 0) as units, coalesce(b.buys, 0) as buys
    from fund_sells s
    left join fund_buys b
      on b.user_id = s.user_id
     and b.fund_id = s.fund_id
     and b.goal_id is not distinct from s.goal_id
),

-- How far each individual sale sits from the flat rate units × basis / total_units,
-- with the two tolerances it may claim. Split out as a CTE because the full-sale
-- slack has to be RATIONED across the holding (see below), which needs a window
-- over the per-sale deviations rather than a row-local predicate.
sale_dev as (
  select w.transaction_id, w.user_id, w.goal_id, w.fund_id, w.parent_transaction_id,
         w.units_withdrawn, w.principal_withdrawn,
         p.transaction_id as holding, p.transaction_id::text as balance_key,
         p.amount_vnd as basis, p.units as units,
         format('a sale of %s of the holding''s %s units took %s đồng where the flat rate on a %s basis is %s',
                w.units_withdrawn, p.units, w.principal_withdrawn, p.amount_vnd,
                round(p.amount_vnd * w.units_withdrawn / p.units)) as detail,
         abs(coalesce(w.principal_withdrawn, 0) - round(p.amount_vnd * w.units_withdrawn / p.units)) as dev,
         p.sells + 1 as base_tol,
         case when p.out_units >= p.units - 0.0001
                then least(abs(p.units - p.out_units), 0.0001) * p.amount_vnd / p.units else 0 end as shortcut_tol,
         p.out_units >= p.units - 0.0001 as exhausted
    from wd w
    join parents p on p.transaction_id = w.parent_transaction_id
   where not w.fund_keyed and p.asset_type = 'gold' and coalesce(p.units, 0) > 0
     and coalesce(w.units_withdrawn, 0) > 0
  union all
  -- Fund-keyed sells only. A fund-parented row is named by its own check, and its
  -- units are as often derived as recorded — comparing a derivation against the
  -- rate it was derived from proves nothing.
  select w.transaction_id, w.user_id, w.goal_id, w.fund_id, w.parent_transaction_id,
         w.units_withdrawn, w.principal_withdrawn,
         null::uuid, b.fund_id::text || ':' || coalesce(b.goal_id::text, ''), b.basis, b.units,
         format('a sell of %s of the bucket''s %s units took %s đồng where the flat rate on a %s basis is %s',
                w.units_withdrawn, b.units, w.principal_withdrawn, b.basis,
                round(b.basis * w.units_withdrawn / b.units)),
         abs(coalesce(w.principal_withdrawn, 0) - round(b.basis * w.units_withdrawn / b.units)),
         b.sells + 1,
         case when b.out_units >= b.units - 0.0001
                then least(abs(b.units - b.out_units), 0.0001) * b.basis / b.units else 0 end,
         b.out_units >= b.units - 0.0001
    from wd w
    join fund_buckets b
      on b.user_id = w.user_id and b.fund_id = w.fund_id and b.goal_id is not distinct from w.goal_id
   where w.fund_keyed and b.units > 0
     and coalesce(w.units_withdrawn, 0) > 0
),

-- Exactly ONE sale per holding can be the one that closed it, so at most one may
-- claim the full-sale slack. Siblings are counted by the BALANCE key and nothing
-- else — parent_transaction_id for bank/gold/stock, (fund, goal) for a fund bucket
-- — because that is what the invariant measures. A withdrawal carries its own
-- goal_id, and for a parent-backed row the invariant ignores it entirely; counting
-- by it would split one holding's sales into separate partitions and hand each of
-- them the slack that only one sale can have. Rows past the base tolerance are counted per holding:
-- if two or more need the slack, the holding cannot be explained by any legal
-- sequence and they are all reported; if just one does, it is allowed its value.
--
-- Sub-epsilon slivers in the tail of an exhausted holding are judged by the same
-- one-closer rule rather than exempted outright: exactly one of them may have been
-- the sale that emptied the basis, so the others must have taken either their flat
-- share or (having come after it) nothing. Two slivers that did neither have no
-- legal reading in any order — 0.9998 units taking 999,800 and then 0.0001 each
-- taking 50 and 150 of the 200 left adds up perfectly and is refused by all six
-- orderings, which is the shape this catches.
--
-- The exemption itself is still limited to a holding that ends EXHAUSTED. A sliver can take a whole remaining basis only if it closed the
-- holding, and which slivers in that tail were legal depends on write order — the
-- undecidable-from-state limit the header records. On a holding with units still
-- unsold nothing closed anything, so a sliver there owes the flat rate like any
-- other sale and is measured like one: 0.0002 units out of 1 closes nothing.
sale_dev_ranked as (
  select d.*,
         d.exhausted and d.units_withdrawn <= 0.0002 as sliver,
         count(*) filter (where d.dev > d.base_tol and not (d.exhausted and d.units_withdrawn <= 0.0002))
           over (partition by d.user_id, d.balance_key) as over_base,
         -- Slivers in the tail that took NEITHER their flat share nor nothing at
         -- all. One of those is the closer emptying the basis; a second one has no
         -- legal reading, whatever order they were written in.
         count(*) filter (where d.exhausted and d.units_withdrawn <= 0.0002
                            and d.dev > d.base_tol and coalesce(d.principal_withdrawn, 0) > 1)
           over (partition by d.user_id, d.balance_key) as odd_slivers
    from sale_dev d
)

-- ── shape, per row ──────────────────────────────────────────────────────────

-- A negative withdrawal ADDS to the holding and banks a credit the next one can
-- spend: every sum here and in lib/depositValuation is signed.
select 'negative_amounts'::text as check_name, 'violation'::text as severity,
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('principal %s, units %s', w.principal_withdrawn, w.units_withdrawn) as detail
  from wd w
 where coalesce(w.principal_withdrawn, 0) < 0 or coalesce(w.units_withdrawn, 0) < 0

union all
-- Without units the overview skips the subtraction entirely (it bails on
-- `units <= 0`), so the fund keeps its full value while the row claims a sale.
select 'fund_sale_missing_units', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('fund sell of %s đồng records units %s', w.principal_withdrawn, w.units_withdrawn)
  from wd w
 where w.fund_keyed and coalesce(w.units_withdrawn, 0) <= 0

union all
-- Gold is the one non-fund holding valued by quantity, so a sale must move both:
-- principal alone drops the cost while every chỉ stays in net worth.
select 'gold_sale_missing_units', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('gold sale of %s đồng records units %s', w.principal_withdrawn, w.units_withdrawn)
  from wd w
 where not w.fund_keyed and w.parent_asset = 'gold' and coalesce(w.units_withdrawn, 0) <= 0

union all
-- No principal takes nothing out: the holding keeps its value while the row claims
-- cash left. The invariant demands a positive principal from a parent-backed
-- withdrawal outright, which is what makes this a violation.
--
-- FUND sells are deliberately not judged here, though they were until a review
-- pointed at the hole. A fund sell's principal is a proportional slice, and a slice
-- can correctly be ZERO when it is worth less than half a đồng — but whether it was
-- worth that is decided by the bucket AS IT WAS when the sale was written, and a
-- purchase arriving later moves the ratio. A 1 đồng / 100 unit bucket makes a
-- 1-unit slice worth nothing; add a 999 đồng purchase afterwards and the same
-- accepted row looks five đồng short. Nothing whose every write was legal may be
-- called a violation, so fund sells are left to sale_basis_not_proportional, whose
-- 'review' severity says exactly this about purchases added after a sale.
select 'withdrawal_missing_principal', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('withdrawal from holding %s records principal %s',
              w.parent_transaction_id, w.principal_withdrawn)
  from wd w
 where coalesce(w.principal_withdrawn, 0) <= 0
   and not w.fund_keyed
   and w.parent_transaction_id is not null

union all
-- A withdrawal is not a holding: parenting to one invents a balance out of money
-- that already left. Renewal snapshots ARE valid parents (#585) and are
-- investments, so they are not caught here.
select 'parent_is_not_an_investment', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('parent %s is a %s', w.parent_transaction_id, w.parent_type)
  from wd w
 where not w.fund_keyed and w.parent_type is not null and w.parent_type <> 'investment'

union all
-- A holding that belongs to someone else (#667, #474 / #525). No write path
-- produces this: the ownership trigger refuses it, so what is left is legacy data,
-- and it is provable from state alone — which is what 'violation' means here.
--
-- The detail names the claim's own figures and the holding it points at, and says
-- nothing about what that holding holds. Comparing the two would be the balance
-- answer check_withdrawal_balance and withdrawal_ledger_replay both decline to
-- invent, and it would report a balance across an RLS boundary besides.
select 'parent_belongs_to_another_user', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('draws %s đồng / %s units on holding %s, which belongs to %s%s',
              coalesce(w.principal_withdrawn, 0), coalesce(w.units_withdrawn, 0),
              w.parent_transaction_id,
              -- Read as an operator both rows are visible and the owner can be
              -- named; read as the claimant the parent is not, and saying so is
              -- more useful than a null.
              case when w.parent_user is not null then 'user ' || w.parent_user::text
                   else 'another user (their rows are not visible to this reader)' end,
              -- A fund-keyed sell draws on its (goal, fund) bucket whatever parent
              -- it also names, so no balance here is wrong and an operator sent
              -- looking for missing money would find none. The parent is still a
              -- reference across an ownership boundary, which is why it is reported.
              case when w.fund_keyed
                     then ' — this sell draws on its own (goal, fund) bucket, so no balance depends on that parent'
                   else '' end)
  from wd w
 where w.parent_transaction_id is not null
   and w.parent_user is distinct from w.user_id

union all
-- Legacy shape, no longer writable. Since #606 buildWithdrawalMaps values such a
-- row against the PURCHASE's (goal, fund) bucket, so its principal does reduce the
-- holding — it is no longer the uncounted withdrawal this check was written for —
-- and check_withdrawal_balance refuses new ones outright, because a fund sale has
-- to be keyed by its fund to be measured against the balance it draws down.
--
-- What is left is history, and it stays reported at 'review' for the thing still
-- worth a human's eye: when the row records no units_withdrawn, the units removed
-- from the bucket are DERIVED pro-rata rather than recorded, and no reader can tell
-- a deliberate quantity from a derived one.
--
-- Do not repair one by hand off this row alone without checking what the dashboard
-- already subtracts for it — the money is offset now, and subtracting it a second
-- time would understate the holding by the same amount this once overstated it.
--
-- The message is gated on what the reader ACTUALLY does with the row. A parent
-- that is fund-typed but carries no fund_id of its own — or that is itself a
-- fund-typed withdrawal — is not a bucket: buildWithdrawalMaps leaves such a row on
-- the parent axis, where nothing reads it, and the parent is not valued either. An
-- audit that told an operator those were "valued against that fund bucket" would
-- have them leave an unvalued row alone, which is the mistake this check is for.
select 'parent_is_a_fund_purchase', 'review',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       case when w.fund_parented
              then format('draws %s đồng on fund purchase %s, valued against that fund bucket with units %s',
                          w.principal_withdrawn, w.parent_transaction_id,
                          -- Zero is derived as well, on both sides: labelling it
                          -- "units 0" would tell an operator nothing was removed
                          -- while the dashboard removed the derived quantity.
                          case when coalesce(w.units_withdrawn, 0) > 0 then w.units_withdrawn::text
                               else 'derived pro-rata' end)
            -- The rest are three different shapes and must not read as one.
            --
            -- ZERO units: the purchase is valued as an ordinary holding, and
            -- lib/depositValuation applies this withdrawal there — a correct row,
            -- said so plainly, because "nothing values it" would invite a repair
            -- that subtracts the money a second time.
            when w.parent_asset = 'fund' and w.parent_fund is not null
                 and w.parent_units is not null and w.parent_units <= 0
              then format('draws %s đồng on fund purchase %s, which holds no units — valued against that purchase, not a bucket',
                          w.principal_withdrawn, w.parent_transaction_id)
            -- NO units recorded: a pending DCA seed. lib/dashboardOverview drops
            -- those from the holdings pass entirely, so the purchase is valued by
            -- nothing and neither is this row — the parent map entry it lands in is
            -- read by no holding at all.
            when w.parent_asset = 'fund' and w.parent_fund is not null
                 and w.parent_units is null
              then format('draws %s đồng on pending fund purchase %s, which records no units — nothing values either row',
                          w.principal_withdrawn, w.parent_transaction_id)
            -- SOMEONE ELSE's fund purchase. It has a fund and units, so none of the
            -- branches above fit, and the fallback below would tell an operator it
            -- "carries no fund of its own" — plainly false, and it sends them
            -- looking for the wrong defect. What is true is that no balance counts
            -- this row: not the bucket (#668) and not the purchase, whose owner
            -- cannot write against it on this axis anyway.
            when w.fund_parent_not_ours
              then format('draws %s đồng on fund purchase %s, which belongs to another user — no balance of either user counts it; see parent_belongs_to_another_user',
                          w.principal_withdrawn, w.parent_transaction_id)
            else format('draws %s đồng on fund-typed %s %s, which carries no fund of its own — no bucket values it',
                        w.principal_withdrawn, w.parent_type, w.parent_transaction_id)
       end
  from wd w
 where not w.fund_keyed and w.parent_asset = 'fund'

union all
-- Filed under neither key: it subtracts from nothing while the record says cash
-- left. What deleting a source leaves behind (#607), among other routes.
--
-- A RETAINED fund_id does not save such a row, which is why this asks only about
-- fund_keyed and the parent. Editing a fund sell's asset_type off 'fund' leaves the
-- fund_id in place (the PUT clears it only when that field is sent), and a bare id
-- is not a bucket key — buildWithdrawalMaps needs asset_type='fund' — so the row
-- draws on nothing at all. Requiring fund_id is null here would have made that
-- shape, the one the invariant refuses by name, invisible to the audit.
select 'draws_on_no_holding', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('takes principal %s / units %s from no holding%s',
              w.principal_withdrawn, w.units_withdrawn,
              case when w.fund_id is not null then ' (fund id retained without asset_type=fund)' else '' end)
  from wd w
 where not w.fund_keyed and w.parent_transaction_id is null
   and (coalesce(w.principal_withdrawn, 0) > 0 or coalesce(w.units_withdrawn, 0) > 0)

union all
-- Claiming nothing and naming nothing is legal for exactly one kind of row: a
-- held-for-merge settlement whose source isn't recorded yet (#588). Nothing else
-- may wear that exception.
select 'sourceless_not_held_for_merge', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       'nothing it draws on, no deltas, and not held_for_merge'
  from wd w
 where not w.fund_keyed and w.parent_transaction_id is null
   and coalesce(w.principal_withdrawn, 0) = 0 and coalesce(w.units_withdrawn, 0) = 0
   and not w.held_for_merge

-- ── balance, per holding ────────────────────────────────────────────────────

union all
-- Past zero. The dashboard then DROPS the holding (valueNonFundHolding returns
-- null at effectiveAmount <= 0) while the excess withdrawal stays in history, so
-- net worth is wrong in a way no screen shows.
-- What the invariant actually caps, and what it does not.
--
-- UNITS are capped for every kind of holding, and the bound is cumulative however
-- many sales there are: each sale is measured against what is LEFT, which already
-- carries the previous sale's excess, so Σunits ≤ units + 0.0001 whatever the
-- count (two sales totalling units + 0.00015 are refused — probed). Selling more of
-- a thing than exists is provable from state, so it is a violation.
--
-- PRINCIPAL is capped only where the invariant caps it: bank and stock, where the
-- amount withdrawn is the user's own figure and the rule is literally
-- `principal_withdrawn > remaining` → refused. There is NO principal cap in the
-- quantity-valued branch. Gold and fund sells are governed by the proportional
-- allocation instead, one sale at a time, and THAT allowance accumulates: a 1 đồng
-- / 5 unit holding sold in three 1-unit slices has each slice's share round to
-- zero, while the invariant separately demands a positive principal from a
-- parent-backed withdrawal — so three đồng legally leave a one đồng holding, every
-- write accepted. Calling that an overdraw would tell an operator to repair a
-- correctly written ledger, which is the one thing 'violation' promises not to do.
-- Quantity-valued basis overruns go to 'review' below instead.
--
-- Units are compared against coalesce: a holding with NO units still has a balance
-- of zero units, and the invariant refuses any positive quantity drawn on it
-- ('5 units exceeds the remaining balance of 0 units'). Skipping the comparison
-- when the parent's units are null let exactly that row report clean.
--
-- And the 4-decimal epsilon is granted only where the invariant grants it: while
-- something is left to round. `case when v_left_units > 0 then c_units_epsilon else
-- 0 end` is its own wording. A holding of zero units — the schema allows one — has
-- no rounding to forgive, so a sliver sold out of it is an overdraw like any other.
select 'holding_overdrawn', 'violation',
       p.user_id, null::uuid, p.transaction_id, null::uuid, p.goal_id,
       format('%s holding of %s đồng / %s units has %s đồng / %s units taken out across %s withdrawal(s)',
              p.asset_type, p.amount_vnd, coalesce(p.units, 0), p.out_principal, p.out_units, p.sells)
  from parents p
 where p.out_units > coalesce(p.units, 0) + case when coalesce(p.units, 0) > 0 then 0.0001 else 0 end
    or (p.asset_type is distinct from 'gold' and p.out_principal > p.amount_vnd)

union all
select 'fund_bucket_overdrawn', 'violation',
       b.user_id, null::uuid, null::uuid, b.fund_id, b.goal_id,
       format('bucket holds %s đồng / %s units and has %s đồng / %s units sold across %s sell(s)',
              b.basis, b.units, b.out_principal, b.out_units, b.sells)
  from fund_buckets b
 where b.buys > 0
   and b.out_units > b.units + case when b.units > 0 then 0.0001 else 0 end

union all
-- The same overrun on the principal side of a quantity-valued holding. Worth
-- looking at — dashboard/overview subtracts exactly this sum from invested capital
-- — but never provable, since accumulated rounding on small slices reaches it
-- legally. The per-sale tolerance is what an honest reading needs, so it is the
-- tolerance used here too.
select 'basis_taken_exceeds_cost', 'review',
       p.user_id, null::uuid, p.transaction_id, null::uuid, p.goal_id,
       format('gold holding cost %s đồng and has %s đồng taken out across %s withdrawal(s)',
              p.amount_vnd, p.out_principal, p.sells)
  from parents p
 where p.asset_type = 'gold' and p.out_principal > p.amount_vnd + p.sells

union all
select 'basis_taken_exceeds_cost', 'review',
       b.user_id, null::uuid, null::uuid, b.fund_id, b.goal_id,
       format('bucket cost %s đồng and has %s đồng sold out of it across %s sell(s)',
              b.basis, b.out_principal, b.sells)
  from fund_buckets b
 where b.buys > 0 and b.out_principal > b.basis + b.sells

union all
-- A sell alone in a bucket: its purchases are in another goal, so nothing here
-- offsets it and the goal that HAS the purchases shows them unsold. What an
-- assign racing a sale leaves behind (#610).
-- ...beyond what a relocation may legally leave behind. check_fund_bucket_solvent
-- (#587) refuses a move only when the bucket would be left owing MORE than 0.0001
-- units or one đồng, so an orphan that small is a state the invariant itself
-- permits — reachable by moving a purchase out from under an epsilon-sized sell.
-- Reporting it as provable corruption would send an operator to repair a ledger
-- nobody wrote wrong; the same thresholds are mirrored here so the two agree.
select 'fund_bucket_has_no_purchases', 'violation',
       b.user_id, b.a_sell::uuid, null::uuid, b.fund_id, b.goal_id,
       format('%s sell(s) taking %s đồng / %s units, with no purchases in this bucket',
              b.sells, b.out_principal, b.out_units)
  from fund_buckets b
 where b.buys = 0
   and (b.out_units > 0.0001 or b.out_principal > 1)

-- ── allocation, per quantity-valued holding ─────────────────────────────────
-- Fund buckets and gold bind the principal TO the units: a sale of all remaining
-- units takes the remaining basis, a partial sale its units-proportional share.
-- That rule is additive and order-independent — each sale takes units × basis /
-- total_units regardless of sequence — so the aggregate is a sound check even
-- though the per-sale history is not reconstructible.
--
-- The tolerance is TWO đồng per sale, and unlike the overdraw bound above this one
-- genuinely has to scale: each partial sale's expectation is recomputed from the
-- ROUNDED remaining basis, so the error compounds rather than cancelling. Worked
-- example, both writes accepted by the invariant — 100 đồng over 15 units, a sale
-- of 7 units taking 48 where the expectation is 47, then 1 unit of the remaining 8
-- taking 8 where the expectation is round(52/8) = 7: the aggregate is 56 against a
-- flat expectation of 53, a drift of 3 across 2 sales.
--
-- Two rather than one-and-a-half because 1.5 is where the measured worst case sits:
-- a search over 400k invariant-legal sale sequences (random basis, units, chain
-- length up to 25, errors pushed to the allowance every time) never exceeded 1.5
-- đồng per sale. It cannot run away, either — writing D for the drift, each sale
-- gives D ← D × (1 − units/remaining_units) + e, a CONTRACTION, so the accumulated
-- part shrinks as the chain grows and the worst cases are short chains.
--
-- Over-taking gains nothing from this slack: the cumulative upper bound stays tight
-- in holding_overdrawn / fund_bucket_overdrawn above.
--
-- 'review', not 'violation': a purchase added to a bucket AFTER a sale legitimately
-- shifts the ratio, and so does a hand-corrected row. The number is the useful
-- part — expected vs actual says how far the basis has drifted from the units.

-- Per SALE as well as per holding, because holding-level totals hide errors that
-- CANCEL: 50 units taking 400 and 50 taking 600 out of a 1000 đồng / 100 unit
-- holding add up to exactly the right basis, while the invariant refuses each one
-- as a first write (50 of 100 units must take 500) — that state is unreachable in
-- any order, and a totals-only audit calls it clean. The flat rate is the right
-- yardstick per row precisely because the allocation rule is additive: each sale
-- takes units × basis / total_units whatever the sequence.
--
-- The tolerance has THREE parts, and the third is the one that matters in practice:
--   sells   the ±1 allowance each sale may use, which the last sale inherits
--   1       the two roundings between the flat rate and the invariant's expectation
--   the value of the units left UNSOLD, and only on a holding that ends exhausted
--           at most one epsilon's worth, since that is as much as can be over or
--           under. The clients round units to 4 decimals in BOTH directions: a full
--           sale of 4 chỉ posts as 3.9999 or 4.0001 with equal ease, and the
--           invariant takes either for a full sale and hands it the whole basis, so
--           the gap against the flat rate runs a thousand đồng each way. The clients round units to 4
--           decimals, so "sell everything" routinely posts a hair UNDER the holding
--           (4 chỉ leaves as 3.9999) and the invariant treats a sale within an
--           epsilon of the rest as a FULL one, taking the whole basis. On an
--           ordinary 40,000,000 đồng gold holding that legitimate gap is a THOUSAND
--           đồng — a flat tolerance reports every full gold sale in the ledger.
--
--           Two conditions keep that slack from covering ordinary misallocation,
--           and both are exact rather than heuristic. The shortcut requires a sale
--           to take within an epsilon of what REMAINS, so (a) at most an epsilon of
--           units can be left behind afterwards — any legal use implies the holding
--           ends exhausted, and a sale of 1 chỉ out of 4 leaves 3 behind and gets
--           nothing — and (b) the gap it opens against the flat rate is exactly the
--           value of the units it did NOT take, which for the closer is the whole
--           holding's unsold remainder. A holding sold out to the last unit had no
--           gap to open: 4 units bought and 4 sold means every sale owes the flat
--           rate exactly, however the sales were split up.
-- Validated against 1.5M invariant-legal sale sequences across four magnitudes of
-- basis and units: no row exceeded it, tightest margin 1.2 đồng.
union all
select 'sale_basis_not_proportional', 'review',
       d.user_id, d.transaction_id, d.parent_transaction_id, d.fund_id, d.goal_id, d.detail
  from sale_dev_ranked d
 where d.dev > d.base_tol
   and case
         when d.sliver
           -- The tail exemption is for ONE closer, not for every sliver in it.
           then d.odd_slivers >= 2 and coalesce(d.principal_withdrawn, 0) > 1
         else d.over_base >= 2 or d.dev > d.base_tol + d.shortcut_tol
       end

union all
select 'basis_not_proportional', 'review',
       p.user_id, null::uuid, p.transaction_id, null::uuid, p.goal_id,
       format('%s of %s units sold should have taken %s đồng of the %s basis, took %s',
              p.out_units, p.units,
              case when p.out_units >= p.units - 0.0001 then p.amount_vnd
                   else round(p.amount_vnd * p.out_units / p.units) end,
              p.amount_vnd, p.out_principal)
  from parents p
 where p.asset_type = 'gold' and coalesce(p.units, 0) > 0
   and abs(p.out_principal
           - case when p.out_units >= p.units - 0.0001 then p.amount_vnd
                  else round(p.amount_vnd * p.out_units / p.units) end) > 2 * p.sells + case when p.out_units >= p.units - 0.0001
                          then least(abs(p.units - p.out_units), 0.0001) * p.amount_vnd / p.units else 0 end

union all
select 'basis_not_proportional', 'review',
       b.user_id, null::uuid, null::uuid, b.fund_id, b.goal_id,
       format('%s of %s units sold should have taken %s đồng of the %s basis, took %s',
              b.out_units, b.units,
              case when b.out_units >= b.units - 0.0001 then b.basis
                   else round(b.basis * b.out_units / b.units) end,
              b.basis, b.out_principal)
  from fund_buckets b
 where b.units > 0
   and abs(b.out_principal
           - case when b.out_units >= b.units - 0.0001 then b.basis
                  else round(b.basis * b.out_units / b.units) end) > 2 * b.sells + case when b.out_units >= b.units - 0.0001
                          then least(abs(b.units - b.out_units), 0.0001) * b.basis / b.units else 0 end;

comment on view public.withdrawal_ledger_audit is
  'Read-only screen of existing withdrawal rows against the decision table enforced by check_withdrawal_balance. severity=violation is provable from state; severity=review is sequence-sensitive. An empty result does NOT prove the ledger clean — see the header (#609).';

-- An operator tool, and there is no screen that reads it. security_invoker means
-- RLS would confine a caller to their own rows anyway, but granting it adds a
-- PostgREST surface for no gain — the same reasoning that revoked
-- check_withdrawal_balance in 20260730000002.
revoke all on public.withdrawal_ledger_audit from anon, authenticated;
