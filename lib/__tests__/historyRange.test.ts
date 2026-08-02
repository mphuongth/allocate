import { describe, it, expect } from 'vitest'
import { rangeStartDate } from '../historyRange'

// Issue #266 — the Overview line chart did not change when a different time
// range was selected. Root cause: the history API only computed a cutoff for
// 6m / 1y / 3y, so '1m' and '3m' (sent by the range pills) fell through to
// "no lower bound" and returned the full dataset — identical to 'All'.

const NOW = new Date('2026-06-15T00:00:00Z')

describe('rangeStartDate', () => {
  it('1m → one month back', () => {
    expect(rangeStartDate('1m', NOW)).toBe('2026-05-15')
  })
  it('3m → three months back', () => {
    expect(rangeStartDate('3m', NOW)).toBe('2026-03-15')
  })
  it('6m → six months back', () => {
    expect(rangeStartDate('6m', NOW)).toBe('2025-12-15')
  })
  it('1y → one year back', () => {
    expect(rangeStartDate('1y', NOW)).toBe('2025-06-15')
  })
  it('all → null (no lower bound)', () => {
    expect(rangeStartDate('all', NOW)).toBeNull()
  })
  it('unknown range → null (defensive default)', () => {
    expect(rangeStartDate('bogus', NOW)).toBeNull()
  })

  // Snapshots are keyed to the business day (Asia/Ho_Chi_Minh), so the cutoff
  // that filters them has to be measured from the same calendar. Subtracting from
  // the UTC date parts moved the cutoff back a day for the first seven hours of
  // each Vietnam day — the chart silently gained a snapshot before 07:00 and lost
  // it again afterwards, within one business day (#591).
  it('measures back from the business day, not the UTC one', () => {
    const vnMidnight = new Date('2026-08-14T17:30:00Z') // 15 Aug 2026, 00:30 in VN
    expect(rangeStartDate('1m', vnMidnight)).toBe('2026-07-15')
    expect(rangeStartDate('1y', vnMidnight)).toBe('2025-08-15')
  })

  it('gives the same cutoff either side of the 06:59 → 07:00 UTC-date rollover', () => {
    const before = new Date('2026-08-14T23:59:00Z') // 15 Aug 2026, 06:59 in VN
    const after = new Date('2026-08-15T00:00:00Z')  // 15 Aug 2026, 07:00 in VN
    expect(rangeStartDate('1m', before)).toBe(rangeStartDate('1m', after))
  })

  it('clamps to the last valid day when the target month is shorter', () => {
    // 31 Mar − 1 month has no 31 Feb; land on the last day of February instead of
    // rolling forward into March (which would drop a month of history).
    expect(rangeStartDate('1m', new Date('2026-03-31T03:00:00Z'))).toBe('2026-02-28')
  })

  it('every selectable range yields a distinct cutoff (the bug: 1m/3m collapsed to All)', () => {
    const cutoffs = ['1m', '3m', '6m', '1y'].map((r) => rangeStartDate(r, NOW))
    expect(cutoffs).toEqual(['2026-05-15', '2026-03-15', '2025-12-15', '2025-06-15'])
    expect(new Set(cutoffs).size).toBe(4)
    // None of them collapse to the "All" (null) bound.
    expect(cutoffs.every((c) => c !== null)).toBe(true)
  })
})
