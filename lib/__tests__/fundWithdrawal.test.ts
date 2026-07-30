import { describe, it, expect } from 'vitest'
import { fundCostBasis } from '../fundWithdrawal'

// One authoritative basis: amount_vnd, because that is the accumulator the
// overview subtracts principal_withdrawn from. The sheets used to reconstruct a
// NAV-based figure through an averaged unit price and post that instead — wrong
// basis, plus the rounding of a round trip through the average.

describe('fundCostBasis', () => {
  it('a full sale takes the whole basis exactly, however it divides', () => {
    // The shape that broke: 2 purchases, basis 2,000,100, 100.005 units. Going
    // through the average (2,000,100 / 100.005 × 100.005) lands on 2,000,101.
    expect(fundCostBasis({ totalBasis: 2_000_100, totalUnits: 100.005, sellUnits: 100.005 }))
      .toBe(2_000_100)
  })

  it('never exceeds the basis, at any quantity', () => {
    const totalBasis = 2_000_100
    const totalUnits = 100.005
    for (const sellUnits of [0.0001, 1, 33.333, 99.9, 100.005]) {
      expect(fundCostBasis({ totalBasis, totalUnits, sellUnits })!).toBeLessThanOrEqual(totalBasis)
    }
  })

  it('allocates a partial sale by units, out of the total', () => {
    expect(fundCostBasis({ totalBasis: 3_000_000, totalUnits: 150, sellUnits: 50 })).toBe(1_000_000)
    // Rounded once: 30 × 2,000,100 / 100.005 = 600,000.0 → 600,000.
    expect(fundCostBasis({ totalBasis: 2_000_100, totalUnits: 100.005, sellUnits: 30 })).toBe(600_000)
  })

  // A stale holding record is not a licence to claim more basis than it cost.
  it('caps a sale larger than the recorded units at the whole basis', () => {
    expect(fundCostBasis({ totalBasis: 1_000_000, totalUnits: 50, sellUnits: 80 })).toBe(1_000_000)
  })

  it('has nothing to report without a basis or units', () => {
    expect(fundCostBasis({ totalBasis: null, totalUnits: 100, sellUnits: 10 })).toBeNull()
    expect(fundCostBasis({ totalBasis: 1_000_000, totalUnits: 0, sellUnits: 10 })).toBeNull()
    expect(fundCostBasis({ totalBasis: 1_000_000, totalUnits: null, sellUnits: 10 })).toBeNull()
  })

  it('takes nothing for a zero sale', () => {
    expect(fundCostBasis({ totalBasis: 1_000_000, totalUnits: 100, sellUnits: 0 })).toBe(0)
  })

  // A fee-bearing purchase: 1,000,000 paid for 49 units at NAV 20,000 (980,000 of
  // NAV cost + 20,000 of fees). The basis is what was PAID, so a full sale removes
  // 1,000,000 from invested — not the 980,000 the average-price route would give.
  it('uses what the purchase cost, not its NAV cost', () => {
    expect(fundCostBasis({ totalBasis: 1_000_000, totalUnits: 49, sellUnits: 49 })).toBe(1_000_000)
  })
})
