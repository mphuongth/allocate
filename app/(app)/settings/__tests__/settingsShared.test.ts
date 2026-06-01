import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  clearAppCaches,
  setLocaleCookie,
  refreshPrices,
  fetchOverview,
  exportPortfolioReport,
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

  it('calls both refresh endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await refreshPrices()
    expect(fetchMock).toHaveBeenCalledWith('/api/cron/refresh-navs')
    expect(fetchMock).toHaveBeenCalledWith('/api/cron/refresh-gold')
  })

  it('swallows errors (best-effort sync)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(refreshPrices()).resolves.toBeUndefined()
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
