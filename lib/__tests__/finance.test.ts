import { describe, it, expect, vi, afterEach } from 'vitest'
import { calcProjectedInterest, isNavStale, insuranceStatus } from '../finance'

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
  it('returns overdue for a past date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29'))
    expect(insuranceStatus('2026-04-01')).toBe('overdue')
  })
  it('returns upcoming for a date within 30 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29'))
    expect(insuranceStatus('2026-05-15')).toBe('upcoming')
  })
  it('returns upcoming for a date 15 days away', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T12:00:00Z'))
    expect(insuranceStatus('2026-05-14')).toBe('upcoming')
  })
  it('returns on_track for a date 31+ days away', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29'))
    expect(insuranceStatus('2026-06-15')).toBe('on_track')
  })
})
