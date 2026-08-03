// Collapse an accumulating ("Loại 2") book's tranches into ONE row in the
// Unallocated list. The overview returns a book as several flat per-tranche
// nonFund items; goal-detail and the needs-attention card already roll these up,
// so this brings the last surface in line. Books are goal-assigned by design, so
// an unallocated book is uncommon — but when one exists (created without a goal)
// it should read as a single deposit, and assigning it moves the whole group
// (the /assign route cascades a book's goal atomically).

import { blendedRate } from '@/lib/accumulating'

// The minimal per-tranche shape this needs — structurally a NonFundUnallocatedItem.
export interface UnallocatedNonFund {
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

// Roll each book's tranches up into one anchor-based row (summed principal +
// value, amount-weighted blended rate rounded for display); non-book items pass
// through untouched. The book row keeps the anchor's transactionId (= the
// deposit_group_id), so the assign/sell actions act on the book as a whole.
export function collapseUnallocatedBooks<T extends UnallocatedNonFund>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  const singles: T[] = []
  for (const it of items) {
    if (it.depositGroupId) {
      const arr = groups.get(it.depositGroupId) ?? []
      arr.push(it)
      groups.set(it.depositGroupId, arr)
    } else {
      singles.push(it)
    }
  }

  const books: T[] = []
  for (const [groupId, rows] of groups) {
    const anchor = rows.find((r) => r.transactionId === groupId) ?? rows[0]
    const amount = rows.reduce((s, r) => s + r.amount, 0)
    const currentValue = rows.reduce((s, r) => s + r.currentValue, 0)
    const rate = blendedRate(rows.map((r) => ({ amount: r.amount, rate: r.interestRate })))
    books.push({
      ...anchor,
      amount,
      currentValue,
      interestRate: Math.round(rate * 10) / 10,
      units: null,
    })
  }

  return [...singles, ...books]
}
