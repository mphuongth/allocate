import type { GoalData, NonFundUnallocatedItem } from '@/features/dashboard/contracts'
import { fundHolding, nonFundHolding, pct, type UnallocatedHolding } from '@/lib/unallocatedSummary'
import { progressCredit } from '@/lib/withdrawalProgress'

export interface GoalHoldingsSummary {
  /** One line per fund position, deposit, book and held settlement in the goal. */
  items: UnallocatedHolding[]
  /**
   * Realized recurring-saving months the overview credits to the goal with no
   * holding row behind them (see realizedRecurringContributions). Derived as the
   * remainder so the printed lines always add up to the goal's value.
   */
  recurringValue: number
  /** Withdrawn with "count toward goal progress" off — spent on the goal's purpose. */
  spentForGoal: number
  /** The progress-bar numerator: the value held plus what was spent for the goal. */
  progressValue: number
}

// An accumulating book reaches the overview as one entry per tranche, all
// carrying the anchor's id as depositGroupId. The goal detail shows it as one
// book; so does the report.
function nonFundLines(nonFunds: NonFundUnallocatedItem[], isVi: boolean): UnallocatedHolding[] {
  const books = new Map<string, NonFundUnallocatedItem[]>()
  const lines: Array<UnallocatedHolding | string> = []
  for (const it of nonFunds) {
    const group = it.depositGroupId
    if (!group) { lines.push(nonFundHolding(it, isVi)); continue }
    if (!books.has(group)) { books.set(group, []); lines.push(group) }
    books.get(group)!.push(it)
  }
  return lines.map((line) => {
    if (typeof line !== 'string') return line
    const tranches = books.get(line)!
    const anchor = tranches.find((t) => t.transactionId === line) ?? tranches[0]
    const totalInvested = tranches.reduce((sum, t) => sum + t.amount, 0)
    const currentValue = tranches.reduce((sum, t) => sum + t.currentValue, 0)
    const profitLoss = currentValue - totalInvested
    return {
      id: line,
      name: nonFundHolding(anchor, isVi).name,
      totalInvested,
      currentValue,
      profitLoss,
      profitLossPercentage: pct(profitLoss, totalInvested),
    }
  })
}

/**
 * What one goal holds, as the PDF report prints it under the goal: every
 * holding, the recurring savings credited without a row, and what was spent for
 * the goal — so the lines reconcile with the value and the % complete the app
 * shows on the goal card.
 */
export function goalHoldingsSummary(goal: GoalData, isVi: boolean): GoalHoldingsSummary {
  const held = (goal.heldForMerge ?? []).map((h): UnallocatedHolding => ({
    id: h.transactionId,
    name: `${h.name ?? (isVi ? 'Sổ chờ gộp' : 'Held deposit')} · ${isVi ? 'Đang chờ gộp' : 'Held for merge'}`,
    totalInvested: h.amount,
    currentValue: h.amount,
    profitLoss: 0,
    profitLossPercentage: 0,
  }))

  const items = [
    ...goal.funds.map(fundHolding),
    ...nonFundLines(goal.nonFunds ?? [], isVi),
    ...held,
  ]

  const itemsValue = items.reduce((sum, it) => sum + it.currentValue, 0)
  // Recurring contributions are whole VND; anything under a đồng is NAV × units noise.
  const remainder = Math.round(goal.currentValue - itemsValue)

  return {
    items,
    recurringValue: Math.max(0, remainder),
    spentForGoal: progressCredit(goal.currentValue, goal.progressValue),
    progressValue: goal.progressValue ?? goal.currentValue,
  }
}
