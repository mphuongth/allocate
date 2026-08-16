import { describe, it, expect } from 'vitest'
import { actionableBooks, type MaturityNonFund, type TaggedTranche } from '../maturityCardItems'

// A YYYY-MM-DD string `n` days from today (deterministic regardless of run date).
function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const tranche = (over: Partial<MaturityNonFund>): MaturityNonFund => ({
  transactionId: 't', type: 'bank', amount: 1_000_000, currentValue: 1_010_000,
  interestRate: 3, expiryDate: daysFromNow(-2), investmentDate: '2025-01-01',
  notes: null, units: null, depositGroupId: 'grp', ...over,
})
const tag = (it: MaturityNonFund, goalId: string | null = 'g1'): TaggedTranche<MaturityNonFund> => ({ it, goalId })

describe('actionableBooks — group accumulating tranches into one card row', () => {
  it('rolls a matured book\'s tranches into ONE row (summed value/principal, blended rate, book maturity, anchor goal)', () => {
    const rows = actionableBooks([
      tag(tranche({ transactionId: 'grp', amount: 50_000_000, currentValue: 51_000_000, interestRate: 3.0, notes: 'My book', investmentDate: '2025-01-01' }), 'g1'),
      tag(tranche({ transactionId: 't2', amount: 10_000_000, currentValue: 10_100_000, interestRate: 3.6, investmentDate: '2025-06-01' }), 'g1'),
    ], false)
    expect(rows).toHaveLength(1)
    const { inv, anchor, goalId } = rows[0]
    expect(inv.id).toBe('grp')
    expect(inv.depositGroupId).toBe('grp')
    expect(inv.principal).toBe(60_000_000)
    expect(inv.value).toBe(61_100_000)
    expect(inv.name).toBe('My book')
    expect(inv.interestRate).toBeCloseTo((50 * 3.0 + 10 * 3.6) / 60, 6)
    expect(inv.investmentDate).toBe('2025-01-01') // earliest tranche opened the book
    expect(anchor.transactionId).toBe('grp')
    expect(goalId).toBe('g1')
  })

  // #659: the promise lives on the anchor, and MaturityResolveSheet gates its
  // whole merge panel on `inv.successorDepositTxId`. Dropping it here left the
  // dashboard card's sheet offering the ordinary renewal fork for a book the
  // database refuses to renew — the user picks an action, confirms, and is
  // refused for a rule the screen never mentioned.
  it('carries the anchor\'s successor promise onto the row', () => {
    const [{ inv }] = actionableBooks([
      tag(tranche({ transactionId: 'grp', successorDepositTxId: 'book-2' })),
      tag(tranche({ transactionId: 't2' })),
    ], false)
    expect(inv.successorDepositTxId).toBe('book-2')
  })

  // A tranche is not the promise. Only the anchor may carry one (the DB's
  // `investment_transactions_successor_shape` says so), so reading it off the
  // first member would invent a handover on a book that has none whenever the
  // anchor sorts late.
  it('reads the promise from the anchor, not from whichever tranche comes first', () => {
    const [{ inv }] = actionableBooks([
      tag(tranche({ transactionId: 't2', successorDepositTxId: 'not-the-anchor' })),
      tag(tranche({ transactionId: 'grp' })),
    ], false)
    expect(inv.successorDepositTxId).toBeNull()
  })

  it('groups a book to ONE row even if its tranches are split across goal buckets, using the anchor\'s goal', () => {
    // Mid-way through #349's non-atomic goal cascade a book can momentarily span
    // goals. Global grouping must still yield one row with the FULL principal and
    // the anchor's goal — so the card and the badge never disagree.
    const rows = actionableBooks([
      tag(tranche({ transactionId: 'grp', amount: 50_000_000, currentValue: 51_000_000 }), 'gAnchor'),
      tag(tranche({ transactionId: 't2', amount: 10_000_000, currentValue: 10_100_000 }), 'gOther'),
    ], false)
    expect(rows).toHaveLength(1)
    expect(rows[0].inv.principal).toBe(60_000_000) // full, not a partial bucket sum
    expect(rows[0].goalId).toBe('gAnchor')
  })

  it('excludes a book whose shared maturity is still well in the future', () => {
    expect(actionableBooks([
      tag(tranche({ transactionId: 'grp', expiryDate: daysFromNow(40) })),
      tag(tranche({ transactionId: 't2', expiryDate: daysFromNow(40) })),
    ], false)).toHaveLength(0)
  })

  it('includes a book maturing within the reminder window (tomorrow)', () => {
    expect(actionableBooks([
      tag(tranche({ transactionId: 'grp', expiryDate: daysFromNow(1) })),
    ], false)).toHaveLength(1)
  })

  it('ignores ungrouped term deposits — it returns books only', () => {
    expect(actionableBooks([
      tag(tranche({ transactionId: 'x', depositGroupId: null, expiryDate: daysFromNow(-1) })),
    ], false)).toHaveLength(0)
  })

  it('keeps two separate books separate', () => {
    const rows = actionableBooks([
      tag(tranche({ transactionId: 'a', depositGroupId: 'a' })),
      tag(tranche({ transactionId: 'b', depositGroupId: 'b' })),
    ], false)
    expect(rows.map((r) => r.inv.id).sort()).toEqual(['a', 'b'])
  })
})
