import { describe, it, expect, vi, afterEach } from 'vitest'
import { fmt, fmtNav, fmtUnits, fmtPct, fmtTimeAgo } from '../formatters'

describe('fmt', () => {
  it('formats whole VND amounts with vi-VN thousands separator', () => {
    expect(fmt(1000000)).toBe('₫ 1.000.000')
  })
  it('rounds fractional values', () => {
    expect(fmt(1000.7)).toBe('₫ 1.001')
    expect(fmt(1000.3)).toBe('₫ 1.000')
  })
  it('formats zero', () => {
    expect(fmt(0)).toBe('₫ 0')
  })
  it('formats negative values', () => {
    expect(fmt(-500000)).toBe('₫ -500.000')
  })
  it('formats large values (billions)', () => {
    expect(fmt(1_000_000_000)).toBe('₫ 1.000.000.000')
  })
})

describe('fmtNav', () => {
  it('always shows exactly 2 decimal places', () => {
    expect(fmtNav(25219)).toBe('₫ 25.219,00')
    expect(fmtNav(25219.5)).toBe('₫ 25.219,50')
  })
  it('makes whole-number NAV values unambiguous (comma suffix shows it is not a decimal)', () => {
    const result = fmtNav(25219)
    expect(result).toContain(',00')
  })
  it('formats zero with decimals', () => {
    expect(fmtNav(0)).toBe('₫ 0,00')
  })
})

describe('fmtUnits', () => {
  it('formats whole units without decimals', () => {
    expect(fmtUnits(2879)).toBe('2.879')
  })
  it('formats fractional units with up to 2 decimal places', () => {
    expect(fmtUnits(2878.83)).toBe('2.878,83')
  })
  it('drops trailing zeros beyond 2 places', () => {
    expect(fmtUnits(2878.8)).toBe('2.878,8')
  })
  it('formats zero', () => {
    expect(fmtUnits(0)).toBe('0')
  })
})

describe('fmtPct', () => {
  it('prefixes positive values with +', () => {
    expect(fmtPct(12.5)).toBe('+12.50%')
  })
  it('does not prefix negative values', () => {
    expect(fmtPct(-3.75)).toBe('-3.75%')
  })
  it('prefixes zero with +', () => {
    expect(fmtPct(0)).toBe('+0.00%')
  })
  it('always shows 2 decimal places', () => {
    expect(fmtPct(1)).toBe('+1.00%')
  })
})

// The "NAV updated N ago" label under the net-worth figure. It was copied
// byte-for-byte into DashboardClient and DesktopNetWorthPanel, so neither copy
// had any coverage of its Vietnamese output (#569).
describe('fmtTimeAgo', () => {
  const NOW = new Date('2026-07-29T12:00:00Z')
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  const withClock = (fn: () => void) => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    fn()
  }

  afterEach(() => vi.useRealTimers())

  it('reads minutes in English and Vietnamese', () => {
    withClock(() => {
      expect(fmtTimeAgo(ago(5 * MIN), 'en')).toBe('5m ago')
      expect(fmtTimeAgo(ago(5 * MIN), 'vi')).toBe('5 phút trước')
    })
  })

  it('reads hours in English and Vietnamese', () => {
    withClock(() => {
      expect(fmtTimeAgo(ago(3 * HOUR), 'en')).toBe('3h ago')
      expect(fmtTimeAgo(ago(3 * HOUR), 'vi')).toBe('3 giờ trước')
    })
  })

  it('reads days in English and Vietnamese', () => {
    withClock(() => {
      expect(fmtTimeAgo(ago(2 * DAY), 'en')).toBe('2d ago')
      expect(fmtTimeAgo(ago(2 * DAY), 'vi')).toBe('2 ngày trước')
    })
  })

  it('reports the largest whole unit, not a rounded one', () => {
    withClock(() => {
      // 90 minutes is an hour and a half — "1h ago", never "2h ago".
      expect(fmtTimeAgo(ago(90 * MIN), 'en')).toBe('1h ago')
      expect(fmtTimeAgo(ago(47 * HOUR), 'en')).toBe('1d ago')
    })
  })

  it('falls back to minutes for anything under an hour, including just now', () => {
    withClock(() => {
      expect(fmtTimeAgo(ago(0), 'en')).toBe('0m ago')
      expect(fmtTimeAgo(ago(59 * MIN), 'vi')).toBe('59 phút trước')
    })
  })

  it('treats any locale that is not Vietnamese as English', () => {
    withClock(() => {
      expect(fmtTimeAgo(ago(5 * MIN), 'fr')).toBe('5m ago')
    })
  })
})
