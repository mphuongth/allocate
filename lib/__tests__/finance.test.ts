import { describe, it, expect, vi, afterEach } from 'vitest'
import { calcProjectedInterest, isNavStale, insuranceStatus, insurancePaidYear, isPlanMonthRealized, isInCurrentCycle } from '../finance'

describe('calcProjectedInterest', () => {
  it('returns 0 when rate is null', () => {
    expect(calcProjectedInterest(10_000_000, null, '2026-01-01')).toBe(0)
  })
  it('returns 0 when rate is 0', () => {
    expect(calcProjectedInterest(10_000_000, 0, '2026-01-01')).toBe(0)
  })
  it('returns 0 when amount is 0', () => {
    expect(calcProjectedInterest(0, 8, '2026-01-01')).toBe(0)
  })
  it('returns 0 when amount is negative', () => {
    expect(calcProjectedInterest(-1000, 8, '2026-01-01')).toBe(0)
  })
  it('caps at expiry date when expiry is in the past', () => {
    const noExpiry = calcProjectedInterest(10_000_000, 8, '2025-01-01')
    const withExpiry = calcProjectedInterest(10_000_000, 8, '2025-01-01', '2025-06-01')
    // with a past expiry, interest should be less than without expiry
    expect(withExpiry).toBeLessThan(noExpiry)
    expect(withExpiry).toBeGreaterThan(0)
  })
  it('produces positive interest for a bank deposit', () => {
    // 10M VND at 8%/year for ~1 year should yield ~800k
    const result = calcProjectedInterest(10_000_000, 8, '2025-04-29')
    expect(result).toBeGreaterThan(700_000)
    expect(result).toBeLessThan(900_000)
  })
})

describe('isNavStale', () => {
  afterEach(() => vi.useRealTimers())

  it('returns false when updated 30 minutes ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'))
    expect(isNavStale('2026-04-29T11:30:00Z')).toBe(false)
  })
  it('returns true when updated 2 days ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'))
    expect(isNavStale('2026-04-27T12:00:00Z')).toBe(true)
  })
  it('returns false when updated exactly 23 hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'))
    expect(isNavStale('2026-04-28T13:00:00Z')).toBe(false)
  })
  it('returns true when updated exactly 25 hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'))
    expect(isNavStale('2026-04-28T11:00:00Z')).toBe(true)
  })
})

describe('insuranceStatus', () => {
  afterEach(() => vi.useRealTimers())

  it('returns on_track when paymentDate is null', () => {
    expect(insuranceStatus(null)).toBe('on_track')
  })

  // A policy's start date sits in the past by definition. It must NOT read as
  // overdue — the first premium is covered at signup and the next one isn't due
  // until the anniversary a year later.
  it('treats a recently-started policy as on_track, not overdue', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28)) // 28 May 2026
    // Started 11 Nov 2025; next anniversary is 11 Nov 2026 — far away.
    expect(insuranceStatus('2025-11-11')).toBe('on_track')
  })

  it('returns upcoming when the next anniversary is within 30 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 29)) // 29 Apr 2026
    // Anniversary 15 May falls 16 days out.
    expect(insuranceStatus('2025-05-15')).toBe('upcoming')
  })

  it('returns on_track when the next anniversary is 31+ days away', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 29)) // 29 Apr 2026
    expect(insuranceStatus('2025-06-15')).toBe('on_track')
  })

  // Overdue requires an anniversary that came due AFTER the covered date and was
  // never settled — i.e. a genuinely missed renewal, not just a past start date.
  it('returns overdue once an anniversary passes unpaid', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 29)) // 29 Apr 2026
    // Started Apr 2025; the Apr 2026 anniversary has passed with no payment.
    expect(insuranceStatus('2025-04-01')).toBe('overdue')
  })

  it('clears overdue when the passed anniversary was settled', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 29)) // 29 Apr 2026
    // Same policy, but the 2026 renewal was paid on 5 Apr 2026.
    expect(insuranceStatus('2025-04-01', '2026-04-05')).toBe('on_track')
  })

  it('stays on_track right after a future renewal date is set', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28)) // 28 May 2026
    // mark-paid advanced the due date to next year and recorded the payment.
    expect(insuranceStatus('2027-05-28', '2026-05-28')).toBe('on_track')
  })

  // A future payment_date with no history is the upcoming due date itself — it
  // must not be pushed a year out by the anniversary roll-forward.
  it('treats a near-future payment date as upcoming', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28)) // 28 May 2026
    expect(insuranceStatus('2026-06-01')).toBe('upcoming')
  })

  it('treats a far-future payment date as on_track', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 28)) // 28 May 2026
    expect(insuranceStatus('2026-08-01')).toBe('on_track')
  })

  it('parses a timestamptz last_payment_date (date portion only)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 29)) // 29 Apr 2026
    expect(insuranceStatus('2025-04-01', '2026-04-05T00:00:00+00:00')).toBe('on_track')
  })
})

describe('isInCurrentCycle', () => {
  it('counts every contribution when nothing has been settled yet', () => {
    expect(isInCurrentCycle('2026-01-01', null)).toBe(true)
    expect(isInCurrentCycle('2026-12-31', null)).toBe(true)
  })
  it('counts a contribution made after the last settlement', () => {
    expect(isInCurrentCycle('2026-06-01', '2026-05-20')).toBe(true)
  })
  // A contribution made on the settlement date starts the next cycle — e.g. you
  // pay today, then log money toward next year today. It must count.
  it('counts a contribution made on the settlement date', () => {
    expect(isInCurrentCycle('2026-05-20', '2026-05-20')).toBe(true)
  })
  it('excludes a contribution made before the last settlement', () => {
    expect(isInCurrentCycle('2026-05-01', '2026-05-20')).toBe(false)
  })
  it('reads only the date portion of a timestamptz', () => {
    expect(isInCurrentCycle('2026-05-20', '2026-05-20T00:00:00+00:00')).toBe(true)
  })
})

describe('isPlanMonthRealized', () => {
  afterEach(() => vi.useRealTimers())

  // A monthly plan only exists once income is set for that month. Its insurance
  // allocation counts as saved once the month has arrived (current or past);
  // a future month's allocation is not saved yet.
  it('counts a past month in the current year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 28)) // May 2026
    expect(isPlanMonthRealized(2026, 3)).toBe(true)
  })
  it('counts the current month', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 28)) // May 2026
    expect(isPlanMonthRealized(2026, 5)).toBe(true)
  })
  it('excludes a future month in the current year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 28)) // May 2026
    expect(isPlanMonthRealized(2026, 6)).toBe(false)
  })
  it('counts any month of a prior year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 28)) // May 2026
    expect(isPlanMonthRealized(2025, 12)).toBe(true)
  })
  it('excludes any month of a future year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 28)) // May 2026
    expect(isPlanMonthRealized(2027, 1)).toBe(false)
  })
})

describe('insurancePaidYear', () => {
  afterEach(() => vi.useRealTimers())

  it('returns null when lastPaymentDate is null', () => {
    expect(insurancePaidYear(null)).toBeNull()
  })
  it('returns the calendar year when paid in the current year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-28'))
    expect(insurancePaidYear('2026-05-28')).toBe(2026)
  })
  it('returns null when the last payment was in a previous year', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-28'))
    expect(insurancePaidYear('2025-12-31')).toBeNull()
  })
  it('treats a Jan 1st plain date as a local date (no shift to the prior year)', () => {
    vi.useFakeTimers()
    // Mid-year local time so "current year" is unambiguously 2026 regardless of
    // the test machine's timezone. A naive new Date('2026-01-01') parses as UTC
    // midnight and slips to 2025 in negative-offset zones — local parsing must not.
    vi.setSystemTime(new Date(2026, 5, 15))
    expect(insurancePaidYear('2026-01-01')).toBe(2026)
  })
  // last_payment_date is a timestamptz column, so the API returns it with a time
  // part. Parsing must read only the date portion or the year is lost (which hid
  // the "Paid for {year}" badge after marking paid).
  it('parses a timestamptz value (date portion only)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 29))
    expect(insurancePaidYear('2026-05-29T00:00:00+00:00')).toBe(2026)
  })
})
