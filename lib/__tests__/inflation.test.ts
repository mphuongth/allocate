import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  DEFAULT_INFLATION_RATE_PCT,
  INFLATION_SCENARIO_RATES,
  yearsUntilYm,
  inflationFactor,
  futureCost,
  presentValue,
  resolveInflationRate,
  goalInflationOutlook,
} from '../inflation'

// Pinned so "the business month" is a fixed point: 5 Sep 2026, 07:00 Vietnam
// time. Every horizon below is counted from 2026-09.
const NOW = new Date('2026-09-05T00:00:00Z')

describe('DEFAULT_INFLATION_RATE_PCT', () => {
  it('sits between the recent historical average and the policy ceiling', () => {
    // ~3.0%/yr average over 2021-2025, ~4.5% is the 2026 control target. A
    // default outside that band would be a claim neither number supports.
    expect(DEFAULT_INFLATION_RATE_PCT).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_INFLATION_RATE_PCT).toBeLessThanOrEqual(4.5)
  })
  it('is one of the scenarios shown, so the default is never off the band', () => {
    expect(INFLATION_SCENARIO_RATES).toContain(DEFAULT_INFLATION_RATE_PCT)
  })
})

describe('yearsUntilYm', () => {
  it('counts whole years to a month that many years out', () => {
    expect(yearsUntilYm('2030-09', NOW)).toBe(4)
  })
  it('returns a fraction for a part-year horizon', () => {
    // 2026-09 → 2030-06 is 45 months.
    expect(yearsUntilYm('2030-06', NOW)).toBeCloseTo(45 / 12, 10)
  })
  it('is 0 for the current month — nothing to project', () => {
    expect(yearsUntilYm('2026-09', NOW)).toBe(0)
  })
  it('is 0 for a month already past, never negative', () => {
    expect(yearsUntilYm('2020-01', NOW)).toBe(0)
  })
  it('is 0 for an unparseable month', () => {
    expect(yearsUntilYm('', NOW)).toBe(0)
    expect(yearsUntilYm('not-a-month', NOW)).toBe(0)
  })
  it('reads the business month, not the runtime\'s local one', () => {
    // 31 Dec 2029, 18:00 UTC is already 1 Jan 2030 in Ho Chi Minh City, so the
    // horizon to 2030-01 has closed. Deriving from UTC would still say a month.
    expect(yearsUntilYm('2030-01', new Date('2029-12-31T18:00:00Z'))).toBe(0)
  })
  it('defaults to now when no instant is passed', () => {
    vi.useFakeTimers().setSystemTime(NOW)
    expect(yearsUntilYm('2030-09')).toBe(4)
  })
  afterEach(() => vi.useRealTimers())
})

describe('inflationFactor', () => {
  it('compounds annually — not the simple interest a term deposit pays', () => {
    // 4% over 2 years is 1.0816, not 1.08. Sharing finance.ts's linear helper
    // here would understate every horizon longer than a year.
    expect(inflationFactor(4, 2)).toBeCloseTo(1.0816, 10)
  })
  it('is 1 at a zero rate', () => {
    expect(inflationFactor(0, 10)).toBe(1)
  })
  it('is 1 over a zero horizon', () => {
    expect(inflationFactor(4, 0)).toBe(1)
  })
  it('handles a fractional horizon', () => {
    expect(inflationFactor(4, 0.5)).toBeCloseTo(Math.sqrt(1.04), 10)
  })
  it('shrinks money under deflation', () => {
    expect(inflationFactor(-2, 1)).toBeCloseTo(0.98, 10)
  })
  it('is 1 for a negative horizon rather than deflating the past', () => {
    expect(inflationFactor(4, -3)).toBe(1)
  })
  it('is 1 for a rate at or below -100%, which has no compound meaning', () => {
    expect(inflationFactor(-100, 5)).toBe(1)
    expect(inflationFactor(-150, 5)).toBe(1)
  })
})

describe('futureCost / presentValue', () => {
  it('says what today\'s basket costs later', () => {
    expect(futureCost(500_000_000, 4, 4)).toBe(Math.round(500_000_000 * 1.04 ** 4))
  })
  it('says what a later amount is worth today', () => {
    expect(presentValue(608_000_000, 4, 4)).toBe(Math.round(608_000_000 / 1.04 ** 4))
  })
  it('round-trips through the same factor', () => {
    expect(presentValue(futureCost(500_000_000, 4, 3.75), 4, 3.75)).toBeCloseTo(500_000_000, 0)
  })
  it('returns whole dong — the currency has no minor unit', () => {
    expect(Number.isInteger(futureCost(123_456_789, 4.45, 2.5))).toBe(true)
    expect(Number.isInteger(presentValue(123_456_789, 4.45, 2.5))).toBe(true)
  })
  it('leaves an amount alone over a zero horizon', () => {
    expect(futureCost(500_000_000, 4, 0)).toBe(500_000_000)
    expect(presentValue(500_000_000, 4, 0)).toBe(500_000_000)
  })
})

describe('resolveInflationRate', () => {
  it('prefers the goal\'s own rate — school fees do not track the general basket', () => {
    expect(resolveInflationRate(9, 4)).toBe(9)
  })
  it('falls back to the user\'s rate when the goal sets none', () => {
    expect(resolveInflationRate(null, 3.5)).toBe(3.5)
    expect(resolveInflationRate(undefined, 3.5)).toBe(3.5)
  })
  it('falls back to the default when the user has set none either', () => {
    expect(resolveInflationRate(null, null)).toBe(DEFAULT_INFLATION_RATE_PCT)
  })
  it('keeps an explicit zero — "assume no inflation" is a choice, not an absence', () => {
    expect(resolveInflationRate(0, 4)).toBe(0)
    expect(resolveInflationRate(null, 0)).toBe(0)
  })
})

describe('goalInflationOutlook', () => {
  const goal = { targetAmount: 500_000_000, targetDate: '2030-06', currentValue: 320_000_000 }

  it('inflates the target and deflates the savings by the SAME factor', () => {
    const out = goalInflationOutlook(goal, 4, NOW)!
    const factor = 1.04 ** (45 / 12)
    expect(out.factor).toBeCloseTo(factor, 10)
    expect(out.targetInFutureMoney).toBe(Math.round(500_000_000 * factor))
    expect(out.savingsInTodayMoney).toBe(Math.round(320_000_000 / factor))
  })

  it('reports the same shortfall in both currencies of the day', () => {
    // The two directions are one comparison seen from either end: the gap in
    // future money, discounted back, must be the gap in today's money. If these
    // ever disagree the card is telling the user two different stories.
    const out = goalInflationOutlook(goal, 4, NOW)!
    expect(out.gapInFutureMoney).toBe(out.targetInFutureMoney - goal.currentValue)
    expect(out.gapInTodayMoney).toBe(Math.round(out.gapInFutureMoney / out.factor))
    expect(out.gapInTodayMoney).toBeCloseTo(goal.targetAmount - out.savingsInTodayMoney, -1)
  })

  it('is bigger than the nominal shortfall — that is the whole point', () => {
    const out = goalInflationOutlook(goal, 4, NOW)!
    expect(out.gapInFutureMoney).toBeGreaterThan(goal.targetAmount - goal.currentValue)
  })

  it('carries the scenario band so a single guess is never the only answer', () => {
    const out = goalInflationOutlook(goal, 4, NOW)!
    expect(out.scenarios.map(s => s.ratePct)).toEqual([...INFLATION_SCENARIO_RATES])
    const years = 45 / 12
    expect(out.scenarios.map(s => s.targetInFutureMoney)).toEqual(
      INFLATION_SCENARIO_RATES.map(r => Math.round(500_000_000 * (1 + r / 100) ** years)),
    )
  })

  it('marks which scenario is the rate in force, even off the standard band', () => {
    expect(goalInflationOutlook(goal, 4, NOW)!.scenarios.filter(s => s.isCurrent).map(s => s.ratePct)).toEqual([4])
    // A per-goal 9% is not one of 3/4/5, so no band entry may claim to be it.
    expect(goalInflationOutlook(goal, 9, NOW)!.scenarios.some(s => s.isCurrent)).toBe(false)
  })

  it('clamps the shortfall at zero once the goal is already met', () => {
    const met = goalInflationOutlook({ ...goal, currentValue: 900_000_000 }, 4, NOW)!
    expect(met.gapInFutureMoney).toBe(0)
    expect(met.gapInTodayMoney).toBe(0)
  })

  it('leaves every amount untouched at a zero rate', () => {
    const out = goalInflationOutlook(goal, 0, NOW)!
    expect(out.targetInFutureMoney).toBe(500_000_000)
    expect(out.savingsInTodayMoney).toBe(320_000_000)
    expect(out.gapInFutureMoney).toBe(180_000_000)
  })

  it('is null without a target amount — there is nothing to inflate', () => {
    expect(goalInflationOutlook({ ...goal, targetAmount: null }, 4, NOW)).toBeNull()
    expect(goalInflationOutlook({ ...goal, targetAmount: 0 }, 4, NOW)).toBeNull()
  })

  it('is null without a target date — a horizon is what makes it compound', () => {
    expect(goalInflationOutlook({ ...goal, targetDate: null }, 4, NOW)).toBeNull()
  })

  it('is null once the target month has arrived or passed', () => {
    // The deadline is now: there is no future to discount, and showing "you
    // need 500tr" as an inflation insight would be noise.
    expect(goalInflationOutlook({ ...goal, targetDate: '2026-09' }, 4, NOW)).toBeNull()
    expect(goalInflationOutlook({ ...goal, targetDate: '2024-01' }, 4, NOW)).toBeNull()
  })

  it('treats a missing current value as nothing saved yet', () => {
    const out = goalInflationOutlook({ targetAmount: 500_000_000, targetDate: '2030-06', currentValue: 0 }, 4, NOW)!
    expect(out.savingsInTodayMoney).toBe(0)
    expect(out.gapInFutureMoney).toBe(out.targetInFutureMoney)
  })
})
