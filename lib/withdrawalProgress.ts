export type WithdrawalRow = {
  transaction_id: string
  goal_id: string | null
  asset_type: string | null
  fund_id: string | null
  parent_transaction_id: string | null
  units_withdrawn: number | null
  principal_withdrawn: number | null
  affects_progress: boolean | null
}

// The investment rows a withdrawal can name as its parent — only enough of each
// to decide which bucket the withdrawal draws on, and to price its units.
export type ParentRow = {
  transaction_id: string
  goal_id: string | null
  asset_type: string | null
  fund_id: string | null
  transaction_type?: string | null
  amount_vnd?: number | null
  units?: number | null
}

export type ParentWdMap = Map<string, { principal: number; units: number }>
export type FundWdMap = Map<string, { units: number; cost: number }>

/** The (goal, fund) bucket key the dashboard accumulates a fund holding under. */
export function fundBucketKey(goalId: string | null, fundId: string): string {
  return `${goalId ?? 'unallocated'}::${fundId}`
}

// Aggregates withdrawals onto their holding along TWO axes that must not be
// conflated:
//   • parentWdMap / fundWdMap   — PROGRESS accounting. Drop affects_progress=false
//     rows so a "doesn't count toward progress" withdrawal leaves the goal bar
//     steady (the rebalance-within-a-goal case).
//   • parentWdMapAll / fundWdMapAll — VALUATION. Count every withdrawal: the money
//     actually left the holding, so book value / net worth must fall regardless of
//     the progress flag. Sharing the progress maps for valuation overstated net
//     worth by the withdrawn amount and made the same deposit show two different
//     values across the dashboard vs the goal-detail tab.
//
// ─── Which bucket a withdrawal draws on — ONE rule (#606) ────────────────────
//
// A withdrawal is valued against a (goal, fund) bucket when it is fund-keyed
// (asset_type='fund' + fund_id) OR when the transaction it names as its parent is
// a fund purchase. Only a withdrawal that is neither is keyed by its parent id.
//
// The second half is what #606 added. A row parented to a fund purchase but not
// itself fund-keyed (no fund_id, or asset_type omitted) used to land in
// parentWdMap under a key nothing reads: the dashboard values a fund through the
// (goal, fund) map and never consults parentWdMap, so the cash left while the fund
// kept every unit. Net worth was overstated by the withdrawn amount, with no error
// and nothing on screen to show it.
//
// The bucket key comes from the PURCHASE, not the withdrawal: that is how
// lib/dashboardOverview keys the accumulator, so the sale lands on the units it
// actually drew on. Units come from `units_withdrawn` when recorded and are
// otherwise derived pro-rata from that one purchase's own price (units ×
// principal / amount, capped at the units it holds) — principal alone would drop
// the cost basis while every unit stayed in net worth, the same trap the invariant
// refuses for gold.
//
// This half is for HISTORY. check_withdrawal_balance refuses the shape at write
// time (20260803000002): one bucket cannot have two balances, and measuring a
// parented row against its purchase while the units come out of the bucket let a
// 45-unit fund-keyed sell and a 10-unit parented one take 55 units out of 50. So
// nothing writes such a row any more; what is already in the ledger is valued here
// rather than left silently uncounted, and withdrawal_ledger_audit reports it.
export function buildWithdrawalMaps(withdrawals: WithdrawalRow[], parents: ParentRow[] = []): {
  parentWdMap: ParentWdMap
  fundWdMap: FundWdMap
  parentWdMapAll: ParentWdMap
  fundWdMapAll: FundWdMap
} {
  const parentWdMap: ParentWdMap = new Map()
  const fundWdMap: FundWdMap = new Map()
  const parentWdMapAll: ParentWdMap = new Map()
  const fundWdMapAll: FundWdMap = new Map()

  const addFund = (map: FundWdMap, key: string, wd: WithdrawalRow) => {
    const e = map.get(key) ?? { units: 0, cost: 0 }
    e.units += wd.units_withdrawn ?? 0
    e.cost += wd.principal_withdrawn ?? 0
    map.set(key, e)
  }
  const addParent = (map: ParentWdMap, key: string, wd: WithdrawalRow) => {
    const e = map.get(key) ?? { principal: 0, units: 0 }
    e.principal += wd.principal_withdrawn ?? 0
    e.units += wd.units_withdrawn ?? 0
    map.set(key, e)
  }

  // Only fund purchases the dashboard actually accumulates as a fund holding are
  // indexed — every other parent stays on the parent axis.
  //
  // `p.units` is part of that, not a tidy-up: lib/dashboardOverview keys a holding
  // into a fund bucket on `asset_type === 'fund' && tx.units`, so a purchase with
  // ZERO units (the validators allow one) is valued as an ordinary holding and has
  // no bucket at all. Redirecting its withdrawal would file the claim where nothing
  // reads it and hand the purchase its full principal back — the #606 bug, from the
  // other side.
  const fundParents = new Map<string, ParentRow>()
  for (const p of parents) {
    if (p.asset_type === 'fund' && p.fund_id && p.units && p.transaction_type !== 'withdrawal') {
      fundParents.set(p.transaction_id, p)
    }
  }

  for (const wd of withdrawals) {
    const affectsProgress = wd.affects_progress !== false
    const fundParent = wd.parent_transaction_id ? fundParents.get(wd.parent_transaction_id) : undefined

    if (wd.asset_type === 'fund' && wd.fund_id) {
      const key = fundBucketKey(wd.goal_id, wd.fund_id)
      addFund(fundWdMapAll, key, wd)
      if (affectsProgress) addFund(fundWdMap, key, wd)
    } else if (fundParent) {
      // Cap the derived units at what the purchase holds: the row can name a
      // principal larger than the purchase cost (the invariant bounds it by the
      // parent's principal, and a repaid/edited row can still exceed it), and
      // inventing units the purchase never had would understate net worth.
      const buyUnits = fundParent.units ?? 0
      const buyAmount = fundParent.amount_vnd ?? 0
      const principal = wd.principal_withdrawn ?? 0
      const derived = buyUnits > 0 && buyAmount > 0
        ? Math.min(buyUnits, (buyUnits * principal) / buyAmount)
        : 0
      // A recorded ZERO is treated as absent, not as a quantity. The old
      // parent-backed write path required positive units only from a gold parent,
      // so `units_withdrawn = 0` alongside a real principal is one of the shapes
      // this legacy data actually wears — and dashboardOverview skips a bucket
      // entry whose units are <= 0 entirely, principal included, which would leave
      // exactly the #606 overstatement this function is here to remove.
      const recorded = wd.units_withdrawn ?? 0
      const row: WithdrawalRow = { ...wd, units_withdrawn: recorded > 0 ? recorded : derived }
      const key = fundBucketKey(fundParent.goal_id, fundParent.fund_id!)
      addFund(fundWdMapAll, key, row)
      if (affectsProgress) addFund(fundWdMap, key, row)
    } else if (wd.parent_transaction_id) {
      addParent(parentWdMapAll, wd.parent_transaction_id, wd)
      if (affectsProgress) addParent(parentWdMap, wd.parent_transaction_id, wd)
    }
  }

  return { parentWdMap, fundWdMap, parentWdMapAll, fundWdMapAll }
}
