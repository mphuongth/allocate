import { describe, it, expect, vi, afterEach } from 'vitest'
import { calcProjectedInterest, isNavStale, insuranceStatus, insurancePaidYear, isPlanMonthRealized, isInCurrentCycle, realizedRecurringContributions } from '../finance'

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
    const asOf = new Date('2026-01-01').getTime()
    const noExpiry = calcProjectedInterest(10_000_000, 8, '2025-01-01', null, asOf)
    const withExpiry = calcProjectedInterest(10_000_000, 8, '2025-01-01', '2025-06-01', asOf)
    // with a past expiry, interest should be less than without expiry
    expect(withExpiry).toBeLessThan(noExpiry)
    expect(withExpiry).toBeGreaterThan(0)
  })
  it('accrues simple (linear) interest pro-rated over the year', () => {
    // 10M at 8%/yr for exactly 365 days = 10M × 0.08 × 1 = 800,000 (no compounding).
    const asOf = new Date('2026-04-29').getTime()
    expect(calcProjectedInterest(10_000_000, 8, '2025-04-29', null, asOf)).toBeCloseTo(800_000, 0)
  })
  it('freezes accrual at maturity — an overdue deposit earns no more after expiry', () => {
    const atMaturity = calcProjectedInterest(10_000_000, 8, '2025-01-01', '2025-07-01', new Date('2025-07-01').getTime())
    const longOverdue = calcProjectedInterest(10_000_000, 8, '2025-01-01', '2025-07-01', new Date('2026-06-01').getTime())
    expect(longOverdue).toBe(atMaturity) // capped — no extra interest past maturity
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

// The overview/savings routes count a plan month toward the current cycle only
// when BOTH gates pass: the month has arrived AND it's on/after the last
// settlement. This proves the transition after paying for a year.
describe('plan allocation counting after a payment (combined gates)', () => {
  afterEach(() => vi.useRealTimers())

  const counts = (y: number, mo: number, lastPaid: string | null) =>
    isPlanMonthRealized(y, mo) &&
    isInCurrentCycle(`${y}-${String(mo).padStart(2, '0')}-01`, lastPaid)

  it('after paying 29 May 2026, forward months count toward next year', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 6, 15)) // 15 Jul 2026
    const paid = '2026-05-29'
    expect(counts(2026, 6, paid)).toBe(true)   // Jun 2026 → toward 2027
    expect(counts(2026, 7, paid)).toBe(true)   // Jul 2026 → toward 2027
    expect(counts(2026, 5, paid)).toBe(false)  // May funded the paid 2026 cycle
    expect(counts(2026, 8, paid)).toBe(false)  // Aug hasn't arrived yet
  })

  it('a 2027 month counts toward the cycle once it arrives', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2027, 1, 10)) // 10 Feb 2027
    const paid = '2026-05-29'
    expect(counts(2027, 1, paid)).toBe(true)   // Jan 2027 arrived → counts
    expect(counts(2027, 3, paid)).toBe(false)  // Mar 2027 not arrived
  })
})

describe('realizedRecurringContributions — dedup against logged deposits', () => {
  afterEach(() => vi.useRealTimers())

  const saving = { saving_id: 's1', goal_id: 'g1', name: 'Vikki', amount_vnd: 2_000_000, effective_from: null, effective_to: null }
  const plan = { id: 'p1', year: 2026, month: 5 }

  it('synthesizes a realized contribution when no deposit is logged', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 15)) // May 2026
    const out = realizedRecurringContributions([saving], [plan], [])
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(2_000_000)
  })

  it('suppresses the synthesized contribution when a matching deposit was logged', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 15))
    const out = realizedRecurringContributions([saving], [plan], [], [
      { month: '2026-05', goalId: 'g1', amount: 2_000_000 },
    ])
    expect(out).toHaveLength(0) // the real deposit represents it — no duplicate
  })

  it('does not suppress when the logged deposit differs in amount', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 15))
    const out = realizedRecurringContributions([saving], [plan], [], [
      { month: '2026-05', goalId: 'g1', amount: 1_000_000 },
    ])
    expect(out).toHaveLength(1)
  })

  it('suppresses one synthesized row per matching deposit (two savings, one deposit)', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 4, 15))
    const s2 = { ...saving, saving_id: 's2' }
    const out = realizedRecurringContributions([saving, s2], [plan], [], [
      { month: '2026-05', goalId: 'g1', amount: 2_000_000 },
    ])
    expect(out).toHaveLength(1) // one suppressed, one still synthesized
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

// Between 00:00 and 06:59 Vietnam time the UTC calendar date is still yesterday,
// so a UTC- or server-local-derived "now" assigns the wrong business month/year.
// These pin the boundary instants that used to drift (#591).
describe('business-day boundaries (Asia/Ho_Chi_Minh)', () => {
  afterEach(() => vi.useRealTimers())

  it('realizes the new month at 00:30 Vietnam time on the 1st', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T17:30:00Z')) // 1 Jun 2026, 00:30 in VN
    expect(isPlanMonthRealized(2026, 6)).toBe(true)
    expect(isPlanMonthRealized(2026, 7)).toBe(false)
  })

  it('realizes the new year at 00:30 Vietnam time on 1 January', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-12-31T17:30:00Z')) // 1 Jan 2026, 00:30 in VN
    expect(isPlanMonthRealized(2026, 1)).toBe(true)
    expect(isPlanMonthRealized(2025, 12)).toBe(true)
    expect(isPlanMonthRealized(2026, 2)).toBe(false)
  })

  it('holds the month across the 06:59 → 07:00 UTC-date rollover', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-31T23:59:00Z')) // 1 Jun 2026, 06:59 in VN
    expect(isPlanMonthRealized(2026, 6)).toBe(true)
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z')) // 1 Jun 2026, 07:00 in VN
    expect(isPlanMonthRealized(2026, 6)).toBe(true)
  })

  it('counts a 1 January payment as the current year at 00:30 Vietnam time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-12-31T17:30:00Z')) // 1 Jan 2026, 00:30 in VN
    expect(insurancePaidYear('2026-01-01')).toBe(2026)
  })

  it('reads a premium that came due yesterday as overdue at 00:30 Vietnam time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T17:30:00Z')) // 15 Jun 2026, 00:30 in VN
    // Anniversary fell on 14 Jun 2026 — yesterday in Vietnam, but still "today"
    // by the UTC clock, which read it as merely upcoming.
    expect(insuranceStatus('2025-06-14')).toBe('overdue')
    // The one falling today is due, not yet missed.
    expect(insuranceStatus('2025-06-15')).toBe('upcoming')
  })
})
