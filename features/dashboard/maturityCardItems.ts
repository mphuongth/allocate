// Group an accumulating ("Loại 2") book's tranches into ONE actionable row for
// the dashboard "Needs attention" card + nav badge. The overview returns a book
// as several flat per-tranche nonFund items (sharing a deposit_group_id), split
// across goal buckets; the single-row term path excludes them
// (isActionableTermDeposit), so without this a matured book would either show N
// rows or — as shipped in #349 — none at all, leaving the user no prompt to
// collapse it.
//
// Grouping is GLOBAL (across every goal bucket + unallocated), not per-bucket, so
// the card and the nav badge can't disagree even if a book is momentarily split
// across goals — e.g. mid-way through #349's non-atomic goal cascade. A book's
// goal context comes from its anchor tranche (the self-grouped row), the
// authoritative owner. This is the single source of truth both consumers share.

import { blendedRate } from '@/lib/accumulating'
import { isActionableAccumulatingBook } from '@/lib/maturity'
import type { InvRow } from '@/features/dashboard/contracts'

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

// A tranche tagged with the goal bucket it came from (null = unallocated). The
// overview splits nonFunds by goal without a goal_id on each item, so callers tag
// them when flattening — letting us group across buckets yet recover each book's
// goal context.
export interface TaggedTranche<T extends MaturityNonFund> {
  it: T
  goalId: string | null
}

// One actionable book: the rolled-up InvRow, its anchor tranche (the self-grouped
// row — context for the resolve flow; withdraw isn't offered for a book so it's
// never used to subtract), and the book's goal (from the anchor).
export interface ActionableBook<T extends MaturityNonFund> {
  inv: InvRow
  anchor: T
  goalId: string | null
}

// The accumulating books among `tagged` that are at/near their shared maturity,
// one InvRow each, grouped globally by deposit_group_id. Ungrouped term deposits
// are ignored here (the caller keeps handling those via isActionableTermDeposit).
export function actionableBooks<T extends MaturityNonFund>(
  tagged: TaggedTranche<T>[],
  isVi: boolean,
): ActionableBook<T>[] {
  const groups = new Map<string, TaggedTranche<T>[]>()
  for (const t of tagged) {
    const gid = t.it.depositGroupId
    if (!gid) continue
    const arr = groups.get(gid) ?? []
    arr.push(t)
    groups.set(gid, arr)
  }

  const out: ActionableBook<T>[] = []
  for (const [groupId, members] of groups) {
    const rows = members.map((m) => m.it)
    const value = rows.reduce((s, r) => s + r.currentValue, 0)
    const principal = rows.reduce((s, r) => s + r.amount, 0)
    // The anchor (deposit_group_id = its own id) carries the book's true goal +
    // maturity; fall back to the first tranche only if it isn't in the set.
    const anchorTag = members.find((m) => m.it.transactionId === groupId) ?? members[0]
    const earliest = rows.reduce((d, r) => (r.investmentDate < d ? r.investmentDate : d), rows[0].investmentDate)
    const inv: InvRow = {
      id: groupId,
      name: anchorTag.it.notes ?? (isVi ? 'Tiền gửi' : 'Bank deposit'),
      type: 'bank',
      value,
      gainPct: principal > 0 ? ((value - principal) / principal) * 100 : null,
      units: null,
      principal,
      interestRate: blendedRate(rows.map((r) => ({ amount: r.amount, rate: r.interestRate }))),
      expiryDate: anchorTag.it.expiryDate,
      investmentDate: earliest,
      fund: null,
      depositGroupId: groupId,
    }
    if (isActionableAccumulatingBook({ type: inv.type, expiryDate: inv.expiryDate, depositGroupId: inv.depositGroupId })) {
      out.push({ inv, anchor: anchorTag.it, goalId: anchorTag.goalId })
    }
  }
  return out
}
