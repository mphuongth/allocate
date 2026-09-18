import { describe, it, expect } from 'vitest'
import { fundCostBasis, fundSaleFigures } from '../fundWithdrawal'

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

// Selling a fund records three numbers that are NOT the same number: how many
// units left the holding, how much of the cost basis went with them, and how
// much cash actually arrived. The sell sheet used to derive all three from one
// field, so a user adjusting the cash to match their broker's confirmation
// silently adjusted the quantity sold too.
describe('fundSaleFigures', () => {
  const bucket = { navPerUnit: 34_380, heldUnits: 200, totalBasis: 6_000_000 }

  it('takes the quantity from the gross, not from the cash received', () => {
    // The regression this function exists to prevent. 100 certificates at 34,380
    // gross 3,438,000; the broker pays 3,430,000 after fee and tax. A hundred
    // certificates left the account either way.
    const full = fundSaleFigures({ ...bucket, gross: 3_438_000 })
    const netted = fundSaleFigures({ ...bucket, gross: 3_438_000, received: 3_430_000 })

    expect(netted.units).toBe(100)
    expect(netted.units).toBe(full.units)
    expect(netted.principal).toBe(full.principal)
  })

  it('records the cash the user says arrived', () => {
    const sale = fundSaleFigures({ ...bucket, gross: 3_438_000, received: 3_430_000 })
    expect(sale.proceeds).toBe(3_430_000)
  })

  it('falls back to the gross when no figure was entered', () => {
    // Nobody who leaves the field alone should see their numbers change.
    for (const received of [null, undefined, 0]) {
      expect(fundSaleFigures({ ...bucket, gross: 3_438_000, received }).proceeds).toBe(3_438_000)
    }
  })

  it('measures the gain against the basis, not against the gross', () => {
    // 100 of 200 units → half of 6,000,000. The fee and tax are a real loss and
    // belong in the gain, which is the whole reason the cash is recorded.
    const sale = fundSaleFigures({ ...bucket, gross: 3_438_000, received: 3_430_000 })
    expect(sale.principal).toBe(3_000_000)
    expect(sale.gain).toBe(430_000)
  })

  it('rounds units before allocating the basis from them', () => {
    // The two have to agree, or a full sale claims a đồng the holding does not
    // have (#587). Units are the rounded figure that gets posted.
    const sale = fundSaleFigures({ navPerUnit: 31_214.47, heldUnits: 100.005, totalBasis: 2_000_100, gross: 3_121_447 })
    expect(sale.units).toBe(parseFloat(sale.units.toFixed(4)))
    expect(sale.principal).toBeLessThanOrEqual(2_000_100)
  })

  it('takes the whole basis when the whole holding goes', () => {
    const sale = fundSaleFigures({ ...bucket, gross: 200 * 34_380 })
    expect(sale.units).toBe(200)
    expect(sale.principal).toBe(6_000_000)
  })

  it('sells everything held when there is no price to divide by', () => {
    const sale = fundSaleFigures({ navPerUnit: null, heldUnits: 200, totalBasis: 6_000_000, gross: 6_876_000 })
    expect(sale.units).toBe(200)
  })

  it('falls back to the cash when the bucket reports no basis', () => {
    // A legacy bucket with nothing recorded: the sale still has to post a
    // principal, and the gross is the only figure available.
    const sale = fundSaleFigures({ ...bucket, totalBasis: null, gross: 3_438_000 })
    expect(sale.principal).toBe(3_438_000)
  })
})
