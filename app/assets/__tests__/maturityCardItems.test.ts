import { describe, it, expect } from 'vitest'
import { actionableBookRows, type MaturityNonFund } from '../maturityCardItems'

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

describe('actionableBookRows — group accumulating tranches into one card row', () => {
  it('rolls a matured book\'s tranches into ONE row (summed value/principal, blended rate, book maturity)', () => {
    const rows = actionableBookRows([
      tranche({ transactionId: 'grp', amount: 50_000_000, currentValue: 51_000_000, interestRate: 3.0, notes: 'My book', investmentDate: '2025-01-01' }),
      tranche({ transactionId: 't2', amount: 10_000_000, currentValue: 10_100_000, interestRate: 3.6, investmentDate: '2025-06-01' }),
    ], false)
    expect(rows).toHaveLength(1)
    const { inv, anchor } = rows[0]
    expect(inv.id).toBe('grp')
    expect(inv.depositGroupId).toBe('grp')
    expect(inv.principal).toBe(60_000_000)
    expect(inv.value).toBe(61_100_000)
    expect(inv.name).toBe('My book')
    expect(inv.interestRate).toBeCloseTo((50 * 3.0 + 10 * 3.6) / 60, 6)
    expect(inv.investmentDate).toBe('2025-01-01') // earliest tranche opened the book
    expect(anchor.transactionId).toBe('grp') // the self-grouped row, for context
  })

  it('excludes a book whose shared maturity is still well in the future', () => {
    expect(actionableBookRows([
      tranche({ transactionId: 'grp', expiryDate: daysFromNow(40) }),
      tranche({ transactionId: 't2', expiryDate: daysFromNow(40) }),
    ], false)).toHaveLength(0)
  })

  it('includes a book maturing within the reminder window (tomorrow)', () => {
    expect(actionableBookRows([
      tranche({ transactionId: 'grp', expiryDate: daysFromNow(1) }),
    ], false)).toHaveLength(1)
  })

  it('ignores ungrouped term deposits — it returns books only', () => {
    expect(actionableBookRows([
      tranche({ transactionId: 'x', depositGroupId: null, expiryDate: daysFromNow(-1) }),
    ], false)).toHaveLength(0)
  })

  it('keeps two separate books separate', () => {
    const rows = actionableBookRows([
      tranche({ transactionId: 'a', depositGroupId: 'a' }),
      tranche({ transactionId: 'b', depositGroupId: 'b' }),
    ], false)
    expect(rows.map((r) => r.inv.id).sort()).toEqual(['a', 'b'])
  })
})
