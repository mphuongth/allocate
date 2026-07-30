import { describe, it, expect } from 'vitest'
import { goldCostBasis, goldUnitCost } from '../goldWithdrawal'

// The cost basis used to be derived through a rounded per-unit price, which
// rounds twice and drifts ABOVE the real basis whenever the principal isn't
// divisible by the units. With the server measuring a withdrawal against the
// balance (#587), that drift is the difference between "sell all" working and
// being refused as an overdraw.

describe('goldCostBasis', () => {
  // The case that breaks a real sale: 123,456,789 / 10 = 12,345,678.9, rounded to
  // 12,345,679, times 10 = 123,456,790 — one đồng more than the holding has.
  it('a full sell takes exactly the remaining principal, however it divides', () => {
    expect(goldCostBasis({ currentPrincipal: 123_456_789, units: 10, sellUnits: 10 }))
      .toBe(123_456_789)
  })

  it('never exceeds the principal, at any quantity', () => {
    const currentPrincipal = 123_456_789
    const units = 10
    for (const sellUnits of [0.5, 1, 3.3333, 7, 9.9999, 10]) {
      expect(goldCostBasis({ currentPrincipal, units, sellUnits })!)
        .toBeLessThanOrEqual(currentPrincipal)
    }
  })

  it('splits a partial sale proportionally', () => {
    expect(goldCostBasis({ currentPrincipal: 90_000_000, units: 10, sellUnits: 3 })).toBe(27_000_000)
    // Rounded once, not twice: 2 × 123,456,789 / 10 = 24,691,357.8 → 24,691,358.
    expect(goldCostBasis({ currentPrincipal: 123_456_789, units: 10, sellUnits: 2 })).toBe(24_691_358)
  })

  // A record showing fewer units than the user sells is stale, not a licence to
  // claim more basis than the holding has.
  it('caps a sale larger than the recorded units at the whole basis', () => {
    expect(goldCostBasis({ currentPrincipal: 50_000_000, units: 2, sellUnits: 5 })).toBe(50_000_000)
  })

  it('has no basis to report without a principal or units', () => {
    expect(goldCostBasis({ currentPrincipal: null, units: 10, sellUnits: 1 })).toBeNull()
    expect(goldCostBasis({ currentPrincipal: 10_000_000, units: 0, sellUnits: 1 })).toBeNull()
    expect(goldCostBasis({ currentPrincipal: 10_000_000, units: null, sellUnits: 1 })).toBeNull()
  })
})

describe('goldUnitCost', () => {
  it('is the rounded per-unit price, for display', () => {
    expect(goldUnitCost(123_456_789, 10)).toBe(12_345_679)
    expect(goldUnitCost(null, 10)).toBeNull()
    expect(goldUnitCost(10_000_000, 0)).toBeNull()
  })
})
