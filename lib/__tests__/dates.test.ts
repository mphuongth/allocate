import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  BUSINESS_TIMEZONE,
  todayIso,
  businessYearMonth,
  businessTodayDate,
  daysUntilIso,
  isFutureInvestmentDate,
} from '../dates'
import { daysUntil } from '../maturity'

afterEach(() => vi.useRealTimers())

// The business day runs on Asia/Ho_Chi_Minh (UTC+7) wherever the code executes —
// a browser in any timezone, or a server in UTC. The instants below are the ones
// that used to drift: between 00:00 and 06:59 Vietnam time the UTC calendar date
// is still *yesterday*, so a UTC-derived "today" recorded the wrong business day.
const VN_0030 = new Date('2026-06-14T17:30:00Z') // 2026-06-15 00:30 in Vietnam
const VN_0659 = new Date('2026-06-13T23:59:00Z') // 2026-06-14 06:59 in Vietnam
const VN_0700 = new Date('2026-06-14T00:00:00Z') // 2026-06-14 07:00 in Vietnam

describe('BUSINESS_TIMEZONE', () => {
  it('is Asia/Ho_Chi_Minh', () => {
    expect(BUSINESS_TIMEZONE).toBe('Asia/Ho_Chi_Minh')
  })
})

describe('todayIso', () => {
  // The contract that ties todayIso to the maturity code: "today" must be 0 days
  // until today.
  it('is 0 days until itself (daysUntil(todayIso()) === 0)', () => {
    expect(daysUntil(todayIso())).toBe(0)
  })

  it('is the Vietnam calendar day just after midnight, not the UTC one', () => {
    expect(todayIso(VN_0030)).toBe('2026-06-15')
    expect(VN_0030.toISOString().slice(0, 10)).toBe('2026-06-14') // what it used to return
  })

  it('holds the same business day across the 06:59 → 07:00 UTC-date rollover', () => {
    expect(todayIso(VN_0659)).toBe('2026-06-14')
    expect(todayIso(VN_0700)).toBe('2026-06-14')
  })

  it('rolls into the new month at Vietnam midnight, not UTC midnight', () => {
    expect(todayIso(new Date('2026-05-31T17:30:00Z'))).toBe('2026-06-01')
  })

  it('rolls into the new year at Vietnam midnight, not UTC midnight', () => {
    expect(todayIso(new Date('2025-12-31T17:30:00Z'))).toBe('2026-01-01')
  })

  it('defaults to the current instant', () => {
    vi.setSystemTime(VN_0030)
    expect(todayIso()).toBe('2026-06-15')
  })
})

describe('businessYearMonth', () => {
  it('reports the Vietnam month at 00:30, not the previous UTC month', () => {
    expect(businessYearMonth(new Date('2026-05-31T17:30:00Z'))).toEqual({ year: 2026, month: 6 })
  })

  it('reports the Vietnam year at 00:30 on 1 January', () => {
    expect(businessYearMonth(new Date('2025-12-31T17:30:00Z'))).toEqual({ year: 2026, month: 1 })
  })

  it('defaults to the current instant', () => {
    vi.setSystemTime(VN_0030)
    expect(businessYearMonth()).toEqual({ year: 2026, month: 6 })
  })
})

describe('businessTodayDate', () => {
  // A local-midnight Date of the business day, for the date arithmetic that still
  // works in Date objects (insuranceStatus's next-due comparison).
  it('is the business day at local midnight', () => {
    const d = businessTodayDate(VN_0030)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 6, 15])
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })
})

describe('daysUntilIso', () => {
  it('counts whole days between plain dates', () => {
    expect(daysUntilIso('2026-06-14', '2026-06-14')).toBe(0)
    expect(daysUntilIso('2026-06-20', '2026-06-14')).toBe(6)
    expect(daysUntilIso('2026-06-13', '2026-06-14')).toBe(-1)
  })

  it('crosses month and year boundaries', () => {
    expect(daysUntilIso('2026-01-01', '2025-12-31')).toBe(1)
    expect(daysUntilIso('2026-03-01', '2026-02-28')).toBe(1)
  })

  it('reads today from the business timezone at 00:30 Vietnam time', () => {
    vi.setSystemTime(VN_0030)
    // A deposit maturing 2026-06-15 has matured *today* in Vietnam (0), not
    // tomorrow (1) as the UTC date would have it.
    expect(daysUntilIso('2026-06-15')).toBe(0)
  })

  it('returns NaN for an unparseable date', () => {
    expect(daysUntilIso('not-a-date', '2026-06-14')).toBeNaN()
  })
})

describe('isFutureInvestmentDate', () => {
  // Client and server now derive "today" in the same business timezone, so no
  // skew allowance is needed: anything past the business day is future-dated.
  const asOf = new Date('2026-06-14T03:00:00Z') // 10:00 in Vietnam, same date

  it('accepts today', () => {
    expect(isFutureInvestmentDate('2026-06-14', asOf)).toBe(false)
  })

  it('accepts a past date', () => {
    expect(isFutureInvestmentDate('2026-01-01', asOf)).toBe(false)
  })

  it('rejects tomorrow and beyond', () => {
    expect(isFutureInvestmentDate('2026-06-15', asOf)).toBe(true)
    expect(isFutureInvestmentDate('2027-01-01', asOf)).toBe(true)
  })

  it('accepts the Vietnam date that is still tomorrow in UTC', () => {
    // 00:30 on 2026-06-15 in Vietnam. A client legitimately recording "today"
    // sends 2026-06-15 while the UTC date is still 2026-06-14.
    expect(isFutureInvestmentDate('2026-06-15', VN_0030)).toBe(false)
    expect(isFutureInvestmentDate('2026-06-16', VN_0030)).toBe(true)
  })

  it('ignores any time portion on the input', () => {
    expect(isFutureInvestmentDate('2026-06-14T23:59:59Z', asOf)).toBe(false)
    expect(isFutureInvestmentDate('2026-06-15T00:00:00Z', asOf)).toBe(true)
  })
})
