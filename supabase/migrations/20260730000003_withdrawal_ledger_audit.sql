-- Read the ledger and report what would not be accepted today (#609).
--
-- #587 put the withdrawal decision table on the table as a trigger
-- (20260730000002). A trigger validates writes, so it never looked at a single row
-- written before it landed: the shapes it now refuses can all still be sitting in
-- history, and every reader — dashboard/overview, withdrawal progress, goal
-- progress — trusts them. Until someone looks, we don't know whether the ledger is
-- clean. The not-knowing is the thing this closes; a backfill is a separate
-- decision that depends on what the report says.
--
-- One check per row of that decision table, plus the two known valuation gaps
-- (#606, #607) so a run is complete rather than nearly complete. Strictly
-- read-only: it names rows and holdings, changes nothing, and is safe to run on
-- production in the SQL editor:
--
--   select check_name, severity, count(*)
--     from public.withdrawal_ledger_audit
--    group by 1, 2 order by 2, 1;
--
-- Then drill into a check_name for the rows and the detail text.
--
-- severity 'violation' — the invariant would refuse this row today.
-- severity 'review'    — legal to write, but it is not counted the way the ledger
--                        assumes; #606 and the proportionality drift below.
--
-- Why a view and not a script kept in a folder: supabase/tests/
-- withdrawal_ledger_audit.test.sql plants one row per check and asserts the audit
-- names it. An audit that returns nothing is indistinguishable from an audit that
-- looks for nothing, and the only way to keep it honest is to make it a database
-- object a test can query. It also cannot drift from the invariant silently —
-- both live in this directory and both are read by the same tests.
--
-- One known limit, worth stating rather than discovering later: whether an
-- epsilon-sized sale was legal depends on the ORDER the rows were written in, and
-- this view reads state. Taking 0.00005 units and then the whole unit is accepted
-- (the epsilon is granted while something is left); exhausting the unit first and
-- then taking 0.00005 is refused — and both leave identical totals, so no
-- state-based check can separate them. The audit stays silent there on purpose,
-- because reporting it would flag ledgers that were written legally. The exposure
-- is bounded by one epsilon of units, and a clean-half test pins the silence.
--
-- Aggregates deliberately mirror the invariant's own measurements, including the
-- exclusions: pending DCA seeds (units null) hold nothing sellable, renewal
-- snapshots are history copies, and a sell keyed by (goal, fund) draws on that
-- bucket rather than on any parent. Getting one of those wrong doesn't produce a
-- miss — it produces a report full of false positives, which is how an audit ends
-- up ignored.
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
         p.asset_type       as parent_asset
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
    join wd w on w.parent_transaction_id = p.transaction_id and not w.fund_keyed
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
  select w.user_id, w.goal_id, w.fund_id,
         sum(coalesce(w.principal_withdrawn, 0)) as out_principal,
         sum(coalesce(w.units_withdrawn, 0))     as out_units,
         count(*)                                as sells,
         min(w.transaction_id::text)             as a_sell
    from wd w
   where w.fund_keyed
   group by w.user_id, w.goal_id, w.fund_id
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
-- Sub-epsilon slivers are left out of the count, but only on a holding that ends
-- EXHAUSTED. A sliver can take a whole remaining basis only if it closed the
-- holding, and which slivers in that tail were legal depends on write order — the
-- undecidable-from-state limit the header records. On a holding with units still
-- unsold nothing closed anything, so a sliver there owes the flat rate like any
-- other sale and is measured like one: 0.0002 units out of 1 closes nothing.
sale_dev_ranked as (
  select d.*,
         count(*) filter (where d.dev > d.base_tol and not (d.exhausted and d.units_withdrawn <= 0.0002))
           over (partition by d.user_id, d.balance_key) as over_base
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
-- No principal takes nothing out: the holding keeps its value while the row
-- claims cash left.
-- Per row, and per row for FUND sales too, not only for parent-backed ones. A
-- fund sale's principal is the units-proportional slice of the basis, so zero is
-- refused by the invariant — but the holding-level check below cannot see it: two
-- sells whose errors cancel (one takes nothing, its sibling takes double) leave
-- the bucket's totals exactly proportional and both invalid rows silent.
select 'withdrawal_missing_principal', 'violation',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('%s records principal %s',
              case when w.fund_keyed then format('fund sale of %s units', w.units_withdrawn)
                   else format('withdrawal from holding %s', w.parent_transaction_id) end,
              w.principal_withdrawn)
  from wd w
  left join fund_buckets b
    on w.fund_keyed and b.user_id = w.user_id and b.fund_id = w.fund_id
   and b.goal_id is not distinct from w.goal_id
 where coalesce(w.principal_withdrawn, 0) <= 0
   and case when w.fund_keyed
              -- units <= 0 is fund_sale_missing_units. And a slice can be worth
              -- NOTHING: round(basis × units / total_units) below half a đồng makes
              -- zero the correct principal, which the invariant accepts (and
              -- lib/fundWithdrawal posts). Only a slice actually worth something —
              -- more than the invariant's own đồng of tolerance — is missing here.
              then coalesce(w.units_withdrawn, 0) > 0
                   and coalesce(b.units, 0) > 0
                   and round(b.basis * w.units_withdrawn / b.units) > 1
            else w.parent_transaction_id is not null end

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
-- Legal to write, counted by nobody: buildWithdrawalMaps values a fund through
-- the (goal, fund) map and never consults the parent map, so this row's principal
-- never reduces anything. Issue #606.
select 'parent_is_a_fund_purchase', 'review',
       w.user_id, w.transaction_id, w.parent_transaction_id, w.fund_id, w.goal_id,
       format('draws %s đồng on fund purchase %s, which no valuation offsets', w.principal_withdrawn, w.parent_transaction_id)
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
-- The tolerances are the invariant's own, and they do NOT accumulate across sales,
-- however many there are: every constraint it applies bounds the CUMULATIVE sum,
-- because each sale is measured against what is left — which already carries the
-- previous sale's excess. Formally Σp ≤ basis + 1 and Σunits ≤ units + 0.0001 for
-- any number of sales; two sales totalling units + 0.00015 are refused, which the
-- test plants and a probe confirmed. So: one đồng wherever the principal is a
-- proportional slice (gold — a deposit's principal is the user's own figure and is
-- bounded exactly, with nothing to round), and one 0.0001 for the clients' 4-decimal
-- rounding on a full sell.
--
-- Units are compared against coalesce: a holding with NO units still has a balance
-- of zero units, and the invariant refuses any positive quantity drawn on it
-- ('5 units exceeds the remaining balance of 0 units'). Skipping the comparison
-- when the parent's units are null let exactly that row report clean.
select 'holding_overdrawn', 'violation',
       p.user_id, null::uuid, p.transaction_id, null::uuid, p.goal_id,
       format('%s holding of %s đồng / %s units has %s đồng / %s units taken out across %s withdrawal(s)',
              p.asset_type, p.amount_vnd, coalesce(p.units, 0), p.out_principal, p.out_units, p.sells)
  from parents p
 where p.out_principal > p.amount_vnd + (case when p.asset_type = 'gold' then 1 else 0 end)
    or p.out_units > coalesce(p.units, 0) + 0.0001

union all
select 'fund_bucket_overdrawn', 'violation',
       b.user_id, null::uuid, null::uuid, b.fund_id, b.goal_id,
       format('bucket holds %s đồng / %s units and has %s đồng / %s units sold across %s sell(s)',
              b.basis, b.units, b.out_principal, b.out_units, b.sells)
  from fund_buckets b
 where b.buys > 0
   and (b.out_principal > b.basis + 1 or b.out_units > b.units + 0.0001)

union all
-- A sell alone in a bucket: its purchases are in another goal, so nothing here
-- offsets it and the goal that HAS the purchases shows them unsold. What an
-- assign racing a sale leaves behind (#610).
select 'fund_bucket_has_no_purchases', 'violation',
       b.user_id, b.a_sell::uuid, null::uuid, b.fund_id, b.goal_id,
       format('%s sell(s) taking %s đồng / %s units, with no purchases in this bucket',
              b.sells, b.out_principal, b.out_units)
  from fund_buckets b
 where b.buys = 0

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
   and not (d.exhausted and d.units_withdrawn <= 0.0002)
   and (d.over_base >= 2 or d.dev > d.base_tol + d.shortcut_tol)

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
  'Read-only audit of existing withdrawal rows against the decision table enforced by check_withdrawal_balance. One row per finding: check_name, severity, and the holding it concerns (#609).';

-- An operator tool, and there is no screen that reads it. security_invoker means
-- RLS would confine a caller to their own rows anyway, but granting it adds a
-- PostgREST surface for no gain — the same reasoning that revoked
-- check_withdrawal_balance in 20260730000002.
revoke all on public.withdrawal_ledger_audit from anon, authenticated;
