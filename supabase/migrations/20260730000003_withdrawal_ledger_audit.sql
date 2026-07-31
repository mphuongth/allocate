-- Screen the ledger for withdrawal rows the invariant would not accept today (#609).
--
-- #587 put the withdrawal decision table on the table as a trigger
-- (20260730000002). A trigger validates writes, so it never looked at a single row
-- written before it landed: the shapes it now refuses can all still be sitting in
-- history, and every reader — dashboard/overview, withdrawal progress, goal
-- progress — trusts them.
--
-- ─── What this view can and cannot tell you ──────────────────────────────────
--
-- AN EMPTY RESULT DOES NOT PROVE THE LEDGER CLEAN, and #609 must not be closed as
-- "verified clean" on the strength of one. This is a limit of the approach, not a
-- missing predicate, and no amount of extra checks removes it:
--
--   The invariant is STATEFUL. It measures each write against the balance
--   remaining at that moment, so whether a row was legal depends on the order the
--   rows were written in. This view reads the ledger as it stands now. Different
--   histories — some legal, some not — reach the very same final state, and the
--   state does not record which one happened.
--
-- The sharpest example, which no ordering of its rows makes legal:
--
--   1000 đồng over 100 units, two sales of 50 units taking 497 and 503. Each is
--   refused as a first write (50 of 100 units must take 500) and neither can
--   follow the other. The totals are exactly proportional, and every per-sale
--   deviation is inside what a legal two-sale ledger can show on some OTHER
--   holding — so nothing here can distinguish it. The audit is silent. A test
--   pins that silence so it is never mistaken for a guarantee.
--
-- Deciding those needs the write order, which exists (created_at) but is only
-- trustworthy once a source's amount and units can no longer be edited under a
-- sale that already drew on them — that is #608. A replay audit on top of #608 is
-- the design that could carry a "verified clean" guarantee; this view is not it.
--
-- ─── The two severities ──────────────────────────────────────────────────────
--
-- 'violation' — provable from the state alone. No ordering of any history could
--               have produced this row, so it is wrong however it got here. Note
--               what that excludes: the principal taken out of a GOLD holding or a
--               fund bucket is not capped by the invariant at all — those follow
--               the proportional allocation, one sale at a time, and that allowance
--               accumulates — so a basis overrun there is reported for review.
-- 'review'    — the ledger looks off, but legally-written ledgers can look the
--               same. Sequence-sensitive: judge these with the rows in front of
--               you, and expect the drift a mid-stream purchase legitimately
--               causes. Never automate a repair off a 'review' row.
--
-- Read-only. It names rows and holdings, changes nothing, and is safe to run on
-- production in the SQL editor:
--
--   select check_name, severity, count(*)
--     from public.withdrawal_ledger_audit
--    group by 1, 2 order by 2, 1;
--
-- Then drill into a check_name for the rows and the detail text.
--
-- Why a view and not a script kept in a folder: supabase/tests/
-- withdrawal_ledger_audit.test.sql plants one row per check and asserts the audit
-- names it. An audit that returns nothing is indistinguishable from an audit that
-- looks for nothing, and the only way to keep it honest is to make it a database
-- object a test can query. It also cannot drift from the invariant silently —
-- both live in this directory and both are read by the same tests.
--
-- A second known limit, narrower than the one above: whether an epsilon-sized sale
-- was legal also depends on write order. Taking 0.00005 units and then the whole
-- unit is accepted (the epsilon is granted while something is left); exhausting the
-- unit first and then taking 0.00005 is refused — identical totals either way. The
-- audit stays silent there rather than report a ledger that was written legally.
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
