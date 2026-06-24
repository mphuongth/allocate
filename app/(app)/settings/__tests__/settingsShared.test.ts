import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clearAppCaches,
  setLocaleCookie,
  refreshPrices,
  fetchOverview,
  exportPortfolioReport,
  fetchLastSync,
  formatLastSync,
} from '../settingsShared'

const downloadPortfolioPDF = vi.fn()
vi.mock('@/lib/generateReport', () => ({
  downloadPortfolioPDF: (...args: unknown[]) => downloadPortfolioPDF(...args),
}))

describe('clearAppCaches', () => {
  beforeEach(() => localStorage.clear())

  it('removes only app cache keys and leaves unrelated keys intact', () => {
    localStorage.setItem('dashboardOverviewCache', '1')
    localStorage.setItem('planningCache_2026-06', '1')
    localStorage.setItem('savingsGoalsCache', '1')
    localStorage.setItem('fixedExpensesCache:bills', '1')
    localStorage.setItem('insuranceMembersCache', '1')
    localStorage.setItem('fundLibraryCache', '1')
    localStorage.setItem('cairn.insuranceCoachDismissed', '1') // unrelated, must survive
    localStorage.setItem('theme', 'dark') // unrelated, must survive

    clearAppCaches()

    expect(localStorage.getItem('dashboardOverviewCache')).toBeNull()
    expect(localStorage.getItem('planningCache_2026-06')).toBeNull()
    expect(localStorage.getItem('savingsGoalsCache')).toBeNull()
    expect(localStorage.getItem('fixedExpensesCache:bills')).toBeNull()
    expect(localStorage.getItem('insuranceMembersCache')).toBeNull()
    expect(localStorage.getItem('fundLibraryCache')).toBeNull()
    expect(localStorage.getItem('cairn.insuranceCoachDismissed')).toBe('1')
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})

describe('setLocaleCookie', () => {
  it('writes the locale cookie with a one-year max-age', () => {
    setLocaleCookie('vi')
    expect(document.cookie).toContain('locale=vi')
  })
})

describe('refreshPrices', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls both refresh endpoints and reports success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await expect(refreshPrices()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/cron/refresh-navs')
    expect(fetchMock).toHaveBeenCalledWith('/api/cron/refresh-gold')
  })

  it('reports failure when an endpoint responds not-ok', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false }))
    await expect(refreshPrices()).resolves.toBe(false)
  })

  it('reports failure (without throwing) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(refreshPrices()).resolves.toBe(false)
  })
})

describe('fetchOverview', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns parsed json when the response is ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ netWorth: 5 }) }))
    expect(await fetchOverview()).toEqual({ netWorth: 5 })
  })

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchOverview()).toBeNull()
  })

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await fetchOverview()).toBeNull()
  })
})

describe('fetchLastSync', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns the lastSync timestamp when the response is ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ lastSync: '2026-06-05T10:00:00.000Z' }),
    }))
    expect(await fetchLastSync()).toBe('2026-06-05T10:00:00.000Z')
  })

  it('returns null when the response carries no timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ lastSync: null }),
    }))
    expect(await fetchLastSync()).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchLastSync()).toBeNull()
  })

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    expect(await fetchLastSync()).toBeNull()
  })
})

describe('formatLastSync', () => {
  // Fixed reference instant so relative output is deterministic.
  const now = new Date('2026-06-05T12:00:00.000Z').getTime()
  const ago = (ms: number) => new Date(now - ms).toISOString()

  it('shows a loading placeholder before the timestamp has loaded', () => {
    expect(formatLastSync(undefined, 'en', now)).toBe('…')
    expect(formatLastSync(undefined, 'vi', now)).toBe('…')
  })

  it('shows a never-synced label when there is no timestamp', () => {
    expect(formatLastSync(null, 'en', now)).toBe('Never')
    expect(formatLastSync(null, 'vi', now)).toBe('Chưa đồng bộ')
  })

  it('shows "just now" for under a minute', () => {
    expect(formatLastSync(ago(30 * 1000), 'en', now)).toBe('just now')
    expect(formatLastSync(ago(30 * 1000), 'vi', now)).toBe('vừa xong')
  })

  it('formats minutes', () => {
    expect(formatLastSync(ago(5 * 60 * 1000), 'en', now)).toBe('5m ago')
    expect(formatLastSync(ago(5 * 60 * 1000), 'vi', now)).toBe('5 phút trước')
  })

  it('formats hours', () => {
    expect(formatLastSync(ago(2 * 60 * 60 * 1000), 'en', now)).toBe('2h ago')
    expect(formatLastSync(ago(2 * 60 * 60 * 1000), 'vi', now)).toBe('2 giờ trước')
  })

  it('formats days', () => {
    expect(formatLastSync(ago(3 * 24 * 60 * 60 * 1000), 'en', now)).toBe('3d ago')
    expect(formatLastSync(ago(3 * 24 * 60 * 60 * 1000), 'vi', now)).toBe('3 ngày trước')
  })
})

describe('exportPortfolioReport', () => {
  beforeEach(() => downloadPortfolioPDF.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('uses the prefetched overview without fetching again', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = { netWorth: 1 } as never
    await exportPortfolioReport(cached, 'en')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(downloadPortfolioPDF).toHaveBeenCalledWith(cached, 'en')
  })

  it('fetches the overview when none is cached', async () => {
    const fresh = { netWorth: 2 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(fresh) }))
    await exportPortfolioReport(null, 'vi')
    expect(downloadPortfolioPDF).toHaveBeenCalledWith(fresh, 'vi')
  })

  it('throws when the overview cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(exportPortfolioReport(null, 'en')).rejects.toThrow('Failed to load portfolio data')
    expect(downloadPortfolioPDF).not.toHaveBeenCalled()
  })
})
