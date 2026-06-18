import { describe, it, expect } from 'vitest'
import { isAccumulating, blendedRate, anchorId, buildCollapsePlan } from '../accumulating'
import { calcProjectedInterest } from '../finance'

describe('isAccumulating', () => {
  it('is true when the row carries a deposit_group_id', () => {
    expect(isAccumulating({ depositGroupId: 'grp-1' })).toBe(true)
  })
  it('is false for an ungrouped (term / one-off) holding', () => {
    expect(isAccumulating({ depositGroupId: null })).toBe(false)
    expect(isAccumulating({ depositGroupId: undefined })).toBe(false)
  })
})

describe('anchorId — the book id a row belongs to', () => {
  it('uses deposit_group_id when grouped, else the row is its own (term)', () => {
    expect(anchorId({ transactionId: 'tx-1', depositGroupId: 'anchor-9' })).toBe('anchor-9')
    expect(anchorId({ transactionId: 'tx-1', depositGroupId: null })).toBe('tx-1')
  })
})

describe('blendedRate — amount-weighted average rate across tranches', () => {
  it('weights each tranche rate by its amount', () => {
    // (50M·3.0 + 2M·3.4 + 2M·3.5) / 54M = 3.0296…%
    const r = blendedRate([
      { amount: 50_000_000, rate: 3.0 },
      { amount: 2_000_000, rate: 3.4 },
      { amount: 2_000_000, rate: 3.5 },
    ])
    expect(r).toBeCloseTo((50 * 3.0 + 2 * 3.4 + 2 * 3.5) / 54, 6)
  })
  it('returns the single rate for one tranche', () => {
    expect(blendedRate([{ amount: 10_000_000, rate: 4.2 }])).toBe(4.2)
  })
  it('treats a null rate as 0 in the weighting', () => {
    expect(blendedRate([{ amount: 1_000_000, rate: null }, { amount: 1_000_000, rate: 4 }])).toBe(2)
  })
  it('returns 0 when there is no principal', () => {
    expect(blendedRate([])).toBe(0)
    expect(blendedRate([{ amount: 0, rate: 5 }])).toBe(0)
  })
})

describe('buildCollapsePlan — per-tranche interest + totals at a book collapse', () => {
  // A fixed instant after the book's maturity so accrual is capped at expiry
  // (the book is being collapsed because it matured) and the test is deterministic.
  const asOf = new Date('2026-07-01T00:00:00Z').getTime()
  const maturity = '2026-06-01'

  it('values each tranche on its own rate (capped at the shared maturity) and sums them', () => {
    const plan = buildCollapsePlan(
      [
        { id: 'a', principal: 50_000_000, rate: 3.0, investmentDate: '2025-06-01', expiryDate: maturity },
        { id: 'b', principal: 2_000_000, rate: 3.4, investmentDate: '2025-09-01', expiryDate: maturity },
        { id: 'c', principal: 2_000_000, rate: 3.5, investmentDate: '2026-01-01', expiryDate: maturity },
      ],
      asOf,
    )
    const iA = Math.round(calcProjectedInterest(50_000_000, 3.0, '2025-06-01', maturity, asOf))
    const iB = Math.round(calcProjectedInterest(2_000_000, 3.4, '2025-09-01', maturity, asOf))
    const iC = Math.round(calcProjectedInterest(2_000_000, 3.5, '2026-01-01', maturity, asOf))
    expect(plan.tranches).toEqual([
      { id: 'a', principal: 50_000_000, interest: iA },
      { id: 'b', principal: 2_000_000, interest: iB },
      { id: 'c', principal: 2_000_000, interest: iC },
    ])
    expect(plan.totalPrincipal).toBe(54_000_000)
    // The book total is the sum of the per-tranche figures the snapshots store, so
    // the rolled lump and the recorded history can never disagree.
    expect(plan.totalInterest).toBe(iA + iB + iC)
  })

  it('gives a rate-less (flex) tranche zero interest but still counts its principal', () => {
    const plan = buildCollapsePlan(
      [{ id: 'a', principal: 1_000_000, rate: null, investmentDate: '2025-06-01', expiryDate: maturity }],
      asOf,
    )
    expect(plan.tranches).toEqual([{ id: 'a', principal: 1_000_000, interest: 0 }])
    expect(plan.totalPrincipal).toBe(1_000_000)
    expect(plan.totalInterest).toBe(0)
  })

  it('handles an empty book (all tranches fully withdrawn) as zero', () => {
    const plan = buildCollapsePlan([], asOf)
    expect(plan).toEqual({ tranches: [], totalPrincipal: 0, totalInterest: 0 })
  })
})
