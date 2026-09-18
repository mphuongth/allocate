import type { DashboardData, FundBreakdownItem, NonFundUnallocatedItem } from '@/features/dashboard/contracts'

/** One unallocated holding, already valued — a fund position or a non-fund tranche. */
interface UnallocatedHolding {
  id: string
  name: string
  totalInvested: number
  currentValue: number
  profitLoss: number
  profitLossPercentage: number
}

export interface UnallocatedSummary {
  /** True when anything is sitting outside a goal — drives whether the section renders at all. */
  hasHoldings: boolean
  items: UnallocatedHolding[]
  totalInvested: number
  currentValue: number
  profitLoss: number
  profitLossPercentage: number
}

function pct(profitLoss: number, invested: number) {
  return invested > 0 ? (profitLoss / invested) * 100 : 0
}

function fundHolding(f: FundBreakdownItem): UnallocatedHolding {
  const profitLoss = f.currentValue - f.costBasis
  return {
    id: f.fundId,
    name: f.fundName,
    totalInvested: f.costBasis,
    currentValue: f.currentValue,
    profitLoss,
    profitLossPercentage: pct(profitLoss, f.costBasis),
  }
}

// Same naming rule the dashboard's sell sheet uses (nonFundToSellItem): the
// user's own note if there is one, otherwise a localised type name — without
// the locale a Vietnamese report printed the raw English "Bank deposit".
function nonFundName(it: NonFundUnallocatedItem, isVi: boolean): string {
  if (it.notes) return it.notes
  if (it.type === 'bank') return isVi ? 'Tiền gửi' : 'Bank deposit'
  if (it.type === 'gold') return isVi ? 'Vàng' : 'Gold'
  return it.type
}

function nonFundHolding(it: NonFundUnallocatedItem, isVi: boolean): UnallocatedHolding {
  const profitLoss = it.currentValue - it.amount
  return {
    id: it.transactionId,
    name: nonFundName(it, isVi),
    totalInvested: it.amount,
    currentValue: it.currentValue,
    profitLoss,
    profitLossPercentage: pct(profitLoss, it.amount),
  }
}

/**
 * Everything unassigned to a goal, as one row per holding plus the totals the
 * PDF report prints under them.
 *
 * The totals' P&L is derived from the summed cost basis rather than from the
 * items' own percentages: a holding's percentage is relative to that position,
 * so averaging percentages across positions of different sizes is meaningless.
 */
export function unallocatedSummary(
  unallocated: DashboardData['unallocated'],
  isVi: boolean,
): UnallocatedSummary {
  const items = [
    ...unallocated.funds.map(fundHolding),
    ...unallocated.nonFunds.map((it) => nonFundHolding(it, isVi)),
  ]

  const totalInvested = items.reduce((sum, it) => sum + it.totalInvested, 0)
  const currentValue = items.reduce((sum, it) => sum + it.currentValue, 0)
  const profitLoss = currentValue - totalInvested

  return {
    hasHoldings: items.length > 0,
    items,
    totalInvested,
    currentValue,
    profitLoss,
    profitLossPercentage: pct(profitLoss, totalInvested),
  }
}
