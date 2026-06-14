import { describe, it, expect, vi, afterEach } from 'vitest'
import { todayIso, isFutureInvestmentDate } from '../dates'
import { daysUntil } from '../maturity'

afterEach(() => vi.useRealTimers())

describe('todayIso', () => {
  // The contract that ties todayIso to the maturity code: "today" must be 0 days
  // until today. daysUntil/fmtMaturity parse plain dates at LOCAL midnight, so a
  // UTC-derived today (new Date().toISOString()) would read as -1 in the first
  // hours of the day in a timezone ahead of UTC (e.g. VN, UTC+7) — the drift
  // this helper exists to remove.
  it('is the local calendar day (daysUntil(todayIso()) === 0)', () => {
    expect(daysUntil(todayIso())).toBe(0)
  })

  it('formats from local date parts', () => {
    // Pin the clock so both new Date() reads see the same instant (no midnight-
    // rollover flake between todayIso()'s read and the expectation's).
    vi.setSystemTime(new Date('2026-06-14T08:30:00'))
    const now = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    expect(todayIso()).toBe(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`)
  })
})

describe('isFutureInvestmentDate', () => {
  // The server runs in UTC but clients send their LOCAL "today". A client ahead
  // of UTC (VN) can legitimately send the server's "tomorrow", so the guard
  // allows one day of skew and only rejects dates clearly in the future.
  const asOf = new Date('2026-06-14T00:00:00Z')

  it('accepts today', () => {
    expect(isFutureInvestmentDate('2026-06-14', asOf)).toBe(false)
  })

  it('accepts a past date', () => {
    expect(isFutureInvestmentDate('2026-01-01', asOf)).toBe(false)
  })

  it('tolerates one day of client/server timezone skew', () => {
    expect(isFutureInvestmentDate('2026-06-15', asOf)).toBe(false)
  })

  it('rejects a date clearly in the future', () => {
    expect(isFutureInvestmentDate('2026-06-16', asOf)).toBe(true)
    expect(isFutureInvestmentDate('2027-01-01', asOf)).toBe(true)
  })

  it('ignores any time portion on the input', () => {
    expect(isFutureInvestmentDate('2026-06-15T23:59:59Z', asOf)).toBe(false)
    expect(isFutureInvestmentDate('2026-06-16T00:00:00Z', asOf)).toBe(true)
  })
})
