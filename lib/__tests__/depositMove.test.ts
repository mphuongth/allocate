import { describe, it, expect } from 'vitest'
import { interestAtMaturity, fundUnitsFor, isUnitEstimateDue } from '@/lib/depositMove'
import { suggestMaturityAction, resolveRenewThreshold, DEFAULT_RENEW_MIN_RATE_PCT } from '@/lib/renewThreshold'

// What a matured term deposit pays and where it goes. Interest is simple, on
// the days actually held over a 365-day year — how a Vietnamese bank pays a
// term deposit (Thông tư 14/2017/TT-NHNN) and how the rest of the app values it
// (lib/finance calcProjectedInterest), so the figure offered at maturity is the
// figure the goal was already counting.

describe('interestAtMaturity', () => {
  const dep = (over: Partial<Parameters<typeof interestAtMaturity>[0]> = {}) =>
    interestAtMaturity({ principal: 100_000_000, rate: 6, investmentDate: '2026-10-01', expiryDate: '2027-04-01', ...over })

  it('pays principal × rate × days/365 for the days actually held', () => {
    // 1 Oct 2026 → 1 Apr 2027 is 182 days: 100M × 6% × 182/365.
    expect(dep()).toBe(2_991_781)
  })

  it.each([
    ['1 month (31 days)', '2026-11-01', 509_589],
    ['3 months (92 days)', '2027-01-01', 1_512_329],
    ['12 months (365 days)', '2027-10-01', 6_000_000],
  ])('%s', (_label, expiryDate, expected) => {
    expect(dep({ expiryDate })).toBe(expected)
  })

  it('counts the extra day of a leap year', () => {
    // 1 Mar 2027 → 1 Mar 2028 spans 29 Feb 2028: 366 days.
    expect(dep({ investmentDate: '2027-03-01', expiryDate: '2028-03-01' })).toBe(6_016_438)
  })

  it('is the full term\'s interest whenever it is asked — before or long after maturity', () => {
    // Accrual stops at maturity; the payout does not depend on today.
    expect(dep()).toBe(dep())
    expect(dep({ investmentDate: '2020-01-01', expiryDate: '2020-07-01' })).toBe(2_991_781)
  })

  it('is zero for a deposit with no rate or no term', () => {
    expect(dep({ rate: null })).toBe(0)
    expect(dep({ rate: 0 })).toBe(0)
    expect(dep({ expiryDate: null })).toBe(0)
    expect(dep({ principal: 0 })).toBe(0)
  })
})

describe('fundUnitsFor', () => {
  it('prices the payout at the NAV, to 2 decimal places of a unit', () => {
    expect(fundUnitsFor(102_991_781, 25_000)).toBe(4119.67)
  })

  it('keeps the fund worth what the deposit paid out — within half a hundredth of a unit', () => {
    // The goal value must not jump when the money moves: the purchase is worth
    // units × NAV, and the only drift allowed is the rounding of units.
    for (const [received, nav] of [[102_991_781, 25_000], [50_500_000, 31_437.52], [7_123_456, 9_999.99]]) {
      const units = fundUnitsFor(received, nav)!
      expect(Math.abs(units * nav - received)).toBeLessThanOrEqual(nav * 0.005 + 1e-6)
    }
  })

  it('has no answer without a NAV or a payout', () => {
    expect(fundUnitsFor(1_000_000, 0)).toBeNull()
    expect(fundUnitsFor(1_000_000, null)).toBeNull()
    expect(fundUnitsFor(0, 25_000)).toBeNull()
  })
})

describe('renew-or-move suggestion', () => {
  it('suggests renewing at or above the threshold, moving below it', () => {
    expect(suggestMaturityAction(9, 8)).toBe('renew')
    expect(suggestMaturityAction(8, 8)).toBe('renew')
    expect(suggestMaturityAction(7.99, 8)).toBe('move')
  })

  it('reads a typed rate exactly, not through float noise', () => {
    // 8.1 − 0.1 is 7.999999999999999 in binary floating point.
    expect(suggestMaturityAction(8.1 - 0.1, 8)).toBe('renew')
  })

  it('answers an unchosen threshold with the 8% default, and keeps a chosen 0', () => {
    expect(resolveRenewThreshold(null)).toBe(DEFAULT_RENEW_MIN_RATE_PCT)
    expect(resolveRenewThreshold(undefined)).toBe(8)
    expect(resolveRenewThreshold(7.5)).toBe(7.5)
    expect(resolveRenewThreshold(0)).toBe(0)
  })
})

describe('isUnitEstimateDue', () => {
  // A purchase priced at an estimated NAV asks to be corrected for the week the
  // order takes to fill, counted from the day it was made.
  const today = '2026-10-10'
  it('is due from the purchase day through the seventh day after it', () => {
    expect(isUnitEstimateDue('2026-10-10', today)).toBe(true)
    expect(isUnitEstimateDue('2026-10-03', today)).toBe(true)
  })

  it('stops asking after a week', () => {
    expect(isUnitEstimateDue('2026-10-02', today)).toBe(false)
  })

  it('does not ask about a date it cannot read', () => {
    expect(isUnitEstimateDue('', today)).toBe(false)
  })
})
