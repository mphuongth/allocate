// Bank-deposit maturity helpers (#467): formatting a maturity date with a relative
// "time left" + tone, and the "needs action" predicates for term deposits and
// accumulating books. Split out of goalDetailShared so the shared UI file stays
// presentational. Imports InvRow as a type only (no runtime dependency back).
import { isTermDeposit, depositMaturityState, isMaturityActionable, isActionableAccumulatingBook } from '@/lib/maturity'
import { fmtTxDate } from './transactionUtils'
import type { InvRow } from './goalDetailShared'

// A bank-deposit maturity date, formatted for display plus a relative
// "time left" summary. Returns null when there's no date. `tone` drives the
// colour: 'neg' once matured (needs action — consistent with the maturity card
// and resolve pill), 'warn' when due within 30 days (or today), 'neutral'
// otherwise (issue #263).
export interface Maturity {
  formatted: string
  diffDays: number
  relative: string
  tone: 'neutral' | 'warn' | 'pos' | 'neg'
}

// Whether a holding is a term deposit at (or within the reminder window of) its
// maturity date — i.e. it needs a renew/withdraw decision. Shared so the mobile
// sheet and desktop panel surface the "Handle maturity" action identically.
export function needsMaturityAction(inv: InvRow, isVi: boolean): boolean {
  if (!isTermDeposit({ type: inv.type, interestRate: inv.interestRate, expiryDate: inv.expiryDate, depositGroupId: inv.depositGroupId })) return false
  const m = fmtMaturity(inv.expiryDate, isVi)
  if (!m) return false
  return isMaturityActionable(depositMaturityState(m.diffDays))
}

// The book counterpart of needsMaturityAction: a matured/maturing accumulating
// book needs a book-level collapse decision (the single-row path above excludes
// grouped rows, so this is the only entry point that surfaces it). Drives the
// same "Handle maturity" action — MaturityResolveBody branches to collapse for a book.
export function needsBookMaturityAction(inv: InvRow): boolean {
  return isActionableAccumulatingBook({ type: inv.type, expiryDate: inv.expiryDate, depositGroupId: inv.depositGroupId })
}

export function fmtMaturity(dateStr: string | null | undefined, isVi: boolean): Maturity | null {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  const formatted = fmtTxDate(dateStr, isVi ? 'vi' : 'en')

  let relative: string
  let tone: Maturity['tone'] = 'neutral'
  if (diffDays < 0) {
    relative = isVi ? 'Đã đáo hạn' : 'Matured'
    tone = 'neg'
  } else if (diffDays === 0) {
    relative = isVi ? 'Đáo hạn hôm nay' : 'Matures today'
    tone = 'warn'
  } else if (diffDays <= 30) {
    relative = isVi ? `Còn ${diffDays} ngày` : `${diffDays} day${diffDays === 1 ? '' : 's'} left`
    tone = 'warn'
  } else {
    relative = isVi ? `Còn ${diffDays} ngày` : `${diffDays} days left`
  }
  return { formatted, diffDays, relative, tone }
}
