// The dashboard's derived view model (#602).
//
// DashboardClient used to compute all of this inline, between its ~30 useState
// calls: which deposits need attention, which siblings a merge may fold in,
// what a sell sheet gets handed. That put the calculations most likely to carry
// a money bug inside a 1,200-line client component, where the only way to test
// one was to render the whole page.
//
// Everything here is a pure function of the overview payload. `data` is
// nullable throughout because the page calls these before the first fetch
// lands, and every one of them has a defined answer for "not loaded yet".

import { isActionableTermDeposit } from '@/lib/maturity'
import { goalCompletion } from '@/lib/finishGoal'
import { detectMergeClusters } from '@/lib/mergeCluster'
import { actionableBooks, type TaggedTranche } from './maturityCardItems'
import type {
  DashboardData,
  FundBreakdownItem,
  GoalData,
  InvRow,
  NonFundUnallocatedItem,
  SellItem,
} from './contracts'

export type SortValue = 'manual' | 'progressDesc' | 'progressAsc' | 'alpha'

// A maturing deposit plus the context needed to act on it: the goal it belongs
// to (null when unassigned) and the raw item for the withdraw flow.
export interface MaturingDep {
  inv: InvRow
  goalId: string | null
  raw: NonFundUnallocatedItem
  // The goal's other bank deposits, attached when the resolve flow opens so the
  // merge UI can fold close-maturing siblings into this re-deposit. Computed
  // lazily (only on open) to keep it off the hot maturingDeposits list.
  siblings?: InvRow[]
  // Pooled "Ví chờ gộp" holdings in this goal, attached on open so the merge
  // sheet can preselect them as held_sources (consumed in place, no second
  // withdrawal).
  heldSiblings?: { id: string; name: string | null; amount: number }[]
}

/**
 * Nothing to show yet — no goals, no holdings, no insurance. `null` data means
 * "not known yet", which is deliberately NOT empty: treating it as empty would
 * flash the onboarding CTA at every user on every cold load.
 */
export function isDashboardEmpty(data: DashboardData | null): boolean {
  if (!data) return false
  return data.goals.length === 0
    && data.unallocated.funds.length === 0
    && data.unallocated.nonFunds.length === 0
    && data.insurance.length === 0
}

// A finished goal's percentage is the one it was archived at, not the one its
// (now empty) holdings compute to — the same rule the cards render by (#650).
const sortPercent = (g: GoalData): number =>
  goalCompletion(g)?.percentage ?? g.progressPercentage ?? 0

/**
 * What the "Download report" sheet previews before the export runs.
 *
 * The count is EVERY goal, completed ones included, because that is what the
 * PDF contains: PortfolioReport iterates the whole list and renders a finished
 * goal as its completion snapshot (#650). Counting only the active ones told a
 * portfolio whose goals are all finished that it had "0 Goals", one tap before
 * handing it a report full of them. The active-only count belongs to the
 * insurance summaries, where an archived goal genuinely has nothing to protect.
 */
export function reportPreviewStats(
  netWorth: { netWorth: number; currentValue: number; overallProfitLoss: number },
  goals: GoalData[],
): { netWorth: number; currentValue: number; totalPL: number; goalCount: number } {
  return {
    netWorth: netWorth.netWorth,
    currentValue: netWorth.currentValue,
    totalPL: netWorth.overallProfitLoss,
    goalCount: goals.length,
  }
}

/** The goal list in the user's chosen order. Never mutates the input. */
export function sortGoals(goals: GoalData[], sort: SortValue): GoalData[] {
  const out = [...goals]
  if (sort === 'progressDesc') out.sort((a, b) => sortPercent(b) - sortPercent(a))
  else if (sort === 'progressAsc') out.sort((a, b) => sortPercent(a) - sortPercent(b))
  else if (sort === 'alpha') out.sort((a, b) => a.goalName.localeCompare(b.goalName))
  return out
}

/**
 * Every non-fund tranche, tagged with the goal bucket it came from (null =
 * unallocated). The overview splits nonFunds by goal without a goal_id on each
 * item, so this is what lets the maturity grouping work across buckets.
 */
export function tagNonFunds(data: DashboardData | null): TaggedTranche<NonFundUnallocatedItem>[] {
  if (!data) return []
  return [
    ...data.goals.flatMap((g) => (g.nonFunds ?? []).map((it) => ({ it, goalId: g.goalId as string | null }))),
    ...data.unallocated.nonFunds.map((it) => ({ it, goalId: null as string | null })),
  ]
}

/**
 * How many deposits need a renew/withdraw decision. Term deposits count one
 * each; an accumulating book counts ONCE, grouped globally across goal buckets.
 *
 * The nav badge and the "needs attention" card both derive from this, so they
 * cannot disagree — the failure mode when they each tallied per-bucket was a
 * book mid-cascade being double-counted by one and missed by the other.
 */
export function maturingCount(tagged: TaggedTranche<NonFundUnallocatedItem>[]): number {
  return tagged.filter(({ it }) => isActionableTermDeposit(it)).length
    + actionableBooks(tagged, false).length
}

/**
 * The rows the "needs attention" card shows — same tally as `maturingCount`,
 * with the context each row needs to act. A book's `raw` is its anchor tranche:
 * context only, since withdraw isn't offered per-tranche for a book.
 */
export function maturingDeposits(
  tagged: TaggedTranche<NonFundUnallocatedItem>[],
  isVi: boolean,
): MaturingDep[] {
  return [
    ...tagged.filter(({ it }) => isActionableTermDeposit(it))
      .map(({ it, goalId }) => ({ inv: nonFundToInvRow(it, isVi), goalId, raw: it })),
    ...actionableBooks(tagged, isVi)
      .map((b) => ({ inv: b.inv, goalId: b.goalId, raw: b.anchor })),
  ]
}

/**
 * Goals whose deposits fall close together, so the card can offer a one-tap
 * "gộp lại". Fed from ALL the goal's bank deposits with an `actionable` flag,
 * which the detector uses to keep the banner to deposits the card lists: a
 * not-yet-due sibling can still be merged from inside the sheet, but it must not
 * inflate a count the user can only see half of (#651). Reuses the eligibility
 * rules so the banner can't over-promise.
 */
export function mergeClusterSummaries(
  tagged: TaggedTranche<NonFundUnallocatedItem>[],
): { anchorId: string; size: number }[] {
  return detectMergeClusters(
    tagged.map(({ it, goalId }) => ({
      id: it.transactionId, goalId, type: it.type, expiryDate: it.expiryDate,
      depositGroupId: it.depositGroupId ?? null, principal: it.amount, value: it.currentValue,
      currency: it.currency ?? null, isPledged: it.isPledged ?? false,
      actionable: isActionableTermDeposit(it),
    })),
  ).map((c) => ({ anchorId: c.anchorId, size: c.size }))
}

/**
 * A goal's OTHER bank deposits, as InvRows the merge flow can fold into a
 * re-deposit. Books are mapped too; the sheet filters them out. Empty for an
 * unassigned deposit — merge is goal-scoped.
 */
export function goalSiblingInvRows(
  data: DashboardData | null,
  goalId: string | null,
  excludeId: string,
  isVi: boolean,
): InvRow[] {
  if (!data || goalId == null) return []
  const goal = data.goals.find((g) => g.goalId === goalId)
  return (goal?.nonFunds ?? [])
    .filter((it) => it.transactionId !== excludeId && it.type === 'bank')
    .map((it) => nonFundToInvRow(it, isVi))
}

/**
 * The goal's pooled "Ví chờ gộp" holdings, for preselect in the anchor's merge
 * sheet. Empty for an unassigned deposit — the pool is goal-scoped.
 */
export function goalHeldSiblings(
  data: DashboardData | null,
  goalId: string | null,
): { id: string; name: string | null; amount: number }[] {
  if (!data || goalId == null) return []
  const goal = data.goals.find((g) => g.goalId === goalId)
  return (goal?.heldForMerge ?? []).map((h) => ({ id: h.transactionId, name: h.name, amount: h.amount }))
}

/** A fund by id, from anywhere in the payload — unallocated or inside a goal. */
export function findFund(data: DashboardData | null, fundId: string | null): FundBreakdownItem | null {
  if (!data || !fundId) return null
  const all = [...data.unallocated.funds, ...data.goals.flatMap((g) => g.funds)]
  return all.find((f) => f.fundId === fundId) ?? null
}

/**
 * Map an overview non-fund holding to the InvRow shape the maturity resolve
 * flow expects. `isVi` localises the no-notes fallback name — without it a
 * Vietnamese user saw the raw English "Bank deposit".
 */
export function nonFundToInvRow(it: NonFundUnallocatedItem, isVi: boolean): InvRow {
  return {
    id: it.transactionId,
    name: it.notes ?? (it.type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') : it.type),
    type: it.type,
    value: it.currentValue,
    gainPct: it.amount > 0 ? ((it.currentValue - it.amount) / it.amount) * 100 : null,
    units: it.units,
    principal: it.amount,
    interestRate: it.interestRate,
    expiryDate: it.expiryDate,
    investmentDate: it.investmentDate,
    fund: null,
    depositGroupId: it.depositGroupId ?? null,
    bankCode: it.type === 'bank' ? (it.bankCode ?? null) : null,
    currency: it.currency ?? null,
    isPledged: it.isPledged ?? false,
    successorDepositTxId: it.successorDepositTxId ?? null,
  }
}

/**
 * Build the SellWithdrawSheet payload for a non-fund holding (bank/gold/stock).
 * `isVi` localises the no-notes fallback name, mirroring nonFundToInvRow.
 */
export function nonFundToSellItem(item: NonFundUnallocatedItem, isVi: boolean): SellItem {
  return {
    type: item.type as 'bank' | 'gold' | 'stock',
    name: item.notes ?? (item.type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') : item.type === 'gold' ? (isVi ? 'Vàng' : 'Gold') : item.type),
    currentValue: item.currentValue,
    units: item.units ?? undefined,
    navPerUnit: item.units && item.units > 0 ? item.currentValue / item.units : undefined,
    interestRate: item.interestRate ?? undefined,
    transactionId: item.transactionId, // for a book this is the anchor (= deposit_group_id)
    purchasePrice: item.amount,
    depositGroupId: item.depositGroupId ?? null,
  }
}

/** The sell payload for a fund position. */
export function sellItemForFund(fund: FundBreakdownItem): SellItem {
  return {
    type: 'fund',
    name: fund.fundName,
    currentValue: fund.currentValue,
    units: fund.quantity,
    navPerUnit: fund.currentNAV,
    gainPct: fund.profitLossPercentage,
    fundId: fund.fundId,
    purchasePrice: fund.purchasePrice,
    // Not purchasePrice: a sale draws on the REMAINING basis, net of prior
    // sells, and the sheet refuses to take out more than that (#587).
    costBasis: fund.costBasis,
  }
}

/**
 * The sell payload for withdrawing a maturing deposit. A book withdraws WHOLE:
 * the item is built from the rolled-up row (book total + anchor id), because
 * prefilling the anchor tranche's value would under-report the balance by every
 * top-up.
 */
export function sellItemForMaturingDeposit(dep: MaturingDep, isVi: boolean): SellItem {
  if (!dep.inv.depositGroupId) return nonFundToSellItem(dep.raw, isVi)
  return {
    type: 'bank',
    name: dep.inv.name,
    currentValue: dep.inv.value,
    transactionId: dep.inv.id,
    purchasePrice: dep.inv.principal ?? dep.inv.value,
    depositGroupId: dep.inv.depositGroupId,
    interestRate: dep.inv.interestRate ?? undefined,
  }
}
