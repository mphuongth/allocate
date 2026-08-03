import { describe, it, expect } from 'vitest'
import { collapseUnallocatedBooks, type UnallocatedNonFund } from '../unallocatedBooks'

const item = (over: Partial<UnallocatedNonFund>): UnallocatedNonFund => ({
  transactionId: 't', type: 'bank', amount: 1_000_000, currentValue: 1_010_000,
  interestRate: 3, expiryDate: '2027-01-01', investmentDate: '2025-01-01',
  notes: null, units: null, depositGroupId: null, ...over,
})

describe('collapseUnallocatedBooks', () => {
  it('rolls a book\'s tranches into one anchor row (summed amount/value, blended rate)', () => {
    const out = collapseUnallocatedBooks([
      item({ transactionId: 'grp', amount: 50_000_000, currentValue: 51_000_000, interestRate: 3.0, notes: 'My book', depositGroupId: 'grp' }),
      item({ transactionId: 't2', amount: 10_000_000, currentValue: 10_100_000, interestRate: 3.6, depositGroupId: 'grp' }),
    ])
    expect(out).toHaveLength(1)
    const book = out[0]
    expect(book.transactionId).toBe('grp')
    expect(book.amount).toBe(60_000_000)
    expect(book.currentValue).toBe(61_100_000)
    expect(book.notes).toBe('My book')
    // (50·3.0 + 10·3.6)/60 = 3.1, rounded to 1dp for display
    expect(book.interestRate).toBe(3.1)
  })

  it('leaves ungrouped (term / one-off) items untouched', () => {
    const out = collapseUnallocatedBooks([
      item({ transactionId: 'a', depositGroupId: null }),
      item({ transactionId: 'b', type: 'gold', depositGroupId: null }),
    ])
    expect(out.map((x) => x.transactionId).sort()).toEqual(['a', 'b'])
    expect(out).toHaveLength(2)
  })

  it('keeps singles and books together; one row per book', () => {
    const out = collapseUnallocatedBooks([
      item({ transactionId: 'single', depositGroupId: null }),
      item({ transactionId: 'gA', depositGroupId: 'gA' }),
      item({ transactionId: 'gA2', depositGroupId: 'gA' }),
      item({ transactionId: 'gB', depositGroupId: 'gB' }),
    ])
    expect(out.map((x) => x.transactionId).sort()).toEqual(['gA', 'gB', 'single'])
  })

  it('falls back to the first tranche when the anchor row is absent (a split book)', () => {
    const out = collapseUnallocatedBooks([
      item({ transactionId: 't2', amount: 10_000_000, currentValue: 10_100_000, depositGroupId: 'grp' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(10_000_000)
  })
})
