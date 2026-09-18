import type { DashboardData } from '@/features/dashboard/contracts'

export interface UnallocatedSummary {
  /** True when anything is sitting outside a goal — drives whether the section renders at all. */
  hasHoldings: boolean
  totalInvested: number
  currentValue: number
  profitLoss: number
  profitLossPercentage: number
}

/**
 * Collapses everything unassigned to a goal — fund positions and non-fund
 * tranches alike — into one invested / value / P&L triple (#725-adjacent: the
 * PDF report only wants the total, not a row per holding).
 *
 * The P&L is derived from the totals rather than summed off the items: a fund
 * item's own `profitLossPercentage` is relative to that position, so adding
 * percentages across holdings of different sizes is meaningless.
 */
export function unallocatedSummary(unallocated: DashboardData['unallocated']): UnallocatedSummary {
  const { funds, nonFunds } = unallocated

  const totalInvested =
    funds.reduce((sum, f) => sum + f.costBasis, 0) +
    nonFunds.reduce((sum, it) => sum + it.amount, 0)
  const currentValue =
    funds.reduce((sum, f) => sum + f.currentValue, 0) +
    nonFunds.reduce((sum, it) => sum + it.currentValue, 0)

  const profitLoss = currentValue - totalInvested

  return {
    hasHoldings: funds.length > 0 || nonFunds.length > 0,
    totalInvested,
    currentValue,
    profitLoss,
    profitLossPercentage: totalInvested > 0 ? (profitLoss / totalInvested) * 100 : 0,
  }
}
