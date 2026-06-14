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

export type ParentWdMap = Map<string, { principal: number; units: number }>
export type FundWdMap = Map<string, { units: number; cost: number }>

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
export function buildWithdrawalMaps(withdrawals: WithdrawalRow[]): {
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

  for (const wd of withdrawals) {
    const affectsProgress = wd.affects_progress !== false

    if (wd.asset_type === 'fund' && wd.fund_id) {
      const key = `${wd.goal_id ?? 'unallocated'}::${wd.fund_id}`
      addFund(fundWdMapAll, key, wd)
      if (affectsProgress) addFund(fundWdMap, key, wd)
    } else if (wd.parent_transaction_id) {
      addParent(parentWdMapAll, wd.parent_transaction_id, wd)
      if (affectsProgress) addParent(parentWdMap, wd.parent_transaction_id, wd)
    }
  }

  return { parentWdMap, fundWdMap, parentWdMapAll, fundWdMapAll }
}
