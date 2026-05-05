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

export function buildWithdrawalMaps(withdrawals: WithdrawalRow[]): {
  parentWdMap: ParentWdMap
  fundWdMap: FundWdMap
} {
  const parentWdMap: ParentWdMap = new Map()
  const fundWdMap: FundWdMap = new Map()

  for (const wd of withdrawals) {
    if (wd.affects_progress === false) continue

    if (wd.asset_type === 'fund' && wd.fund_id) {
      const key = `${wd.goal_id ?? 'unallocated'}::${wd.fund_id}`
      const e = fundWdMap.get(key) ?? { units: 0, cost: 0 }
      e.units += wd.units_withdrawn ?? 0
      e.cost += wd.principal_withdrawn ?? 0
      fundWdMap.set(key, e)
    } else if (wd.parent_transaction_id) {
      const e = parentWdMap.get(wd.parent_transaction_id) ?? { principal: 0, units: 0 }
      e.principal += wd.principal_withdrawn ?? 0
      e.units += wd.units_withdrawn ?? 0
      parentWdMap.set(wd.parent_transaction_id, e)
    }
  }

  return { parentWdMap, fundWdMap }
}
