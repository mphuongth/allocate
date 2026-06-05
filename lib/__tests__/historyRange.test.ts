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

  it('every selectable range yields a distinct cutoff (the bug: 1m/3m collapsed to All)', () => {
    const cutoffs = ['1m', '3m', '6m', '1y'].map((r) => rangeStartDate(r, NOW))
    expect(cutoffs).toEqual(['2026-05-15', '2026-03-15', '2025-12-15', '2025-06-15'])
    expect(new Set(cutoffs).size).toBe(4)
    // None of them collapse to the "All" (null) bound.
    expect(cutoffs.every((c) => c !== null)).toBe(true)
  })
})
