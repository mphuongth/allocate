// Group an accumulating ("Loại 2") book's tranches into ONE actionable row for
// the dashboard "Needs attention" card + nav badge. The overview returns a book
// as several flat per-tranche nonFund items (sharing a deposit_group_id); the
// single-row term path excludes them (isActionableTermDeposit), so without this a
// matured book would either show N rows or — as shipped in #349 — none at all,
// leaving the user no prompt to collapse it. This rolls the tranches up the same
// way buildInvRows does for goal-detail, and is the single source of truth the
// card, the dashboard count, and the nav badge hook all share so they can't
// disagree.

import { blendedRate } from '@/lib/accumulating'
import { isActionableAccumulatingBook } from '@/lib/maturity'
import type { InvRow } from './components/goalDetailShared'

// The minimal per-tranche shape this needs — structurally a NonFundUnallocatedItem
// (so callers pass their overview items directly).
export interface MaturityNonFund {
  transactionId: string
  type: string
  amount: number
  currentValue: number
  interestRate: number | null
  expiryDate: string | null
  investmentDate: string
  notes: string | null
  units: number | null
  depositGroupId?: string | null
}

// One actionable book: the rolled-up InvRow plus its anchor tranche (the self-
// grouped row, carried for the resolve flow's context — withdraw isn't offered
// for a book, so it's never used to subtract).
export interface ActionableBook<T extends MaturityNonFund> {
  inv: InvRow
  anchor: T
}

// The accumulating books in `nonFunds` that are at/near their shared maturity,
// one InvRow each. Ungrouped term deposits are ignored here (the caller keeps
// handling those via isActionableTermDeposit).
export function actionableBookRows<T extends MaturityNonFund>(nonFunds: T[], isVi: boolean): ActionableBook<T>[] {
  const groups = new Map<string, T[]>()
  for (const it of nonFunds) {
    if (!it.depositGroupId) continue
    const arr = groups.get(it.depositGroupId) ?? []
    arr.push(it)
    groups.set(it.depositGroupId, arr)
  }

  const out: ActionableBook<T>[] = []
  for (const [groupId, rows] of groups) {
    const value = rows.reduce((s, r) => s + r.currentValue, 0)
    const principal = rows.reduce((s, r) => s + r.amount, 0)
    const anchor = rows.find((r) => r.transactionId === groupId) ?? rows[0]
    const earliest = rows.reduce((d, r) => (r.investmentDate < d ? r.investmentDate : d), rows[0].investmentDate)
    const inv: InvRow = {
      id: groupId,
      name: anchor.notes ?? (isVi ? 'Tiền gửi' : 'Bank deposit'),
      type: 'bank',
      value,
      gainPct: principal > 0 ? ((value - principal) / principal) * 100 : null,
      units: null,
      principal,
      interestRate: blendedRate(rows.map((r) => ({ amount: r.amount, rate: r.interestRate }))),
      expiryDate: anchor.expiryDate,
      investmentDate: earliest,
      fund: null,
      depositGroupId: groupId,
    }
    if (isActionableAccumulatingBook({ type: inv.type, expiryDate: inv.expiryDate, depositGroupId: inv.depositGroupId })) {
      out.push({ inv, anchor })
    }
  }
  return out
}
