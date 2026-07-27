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

// "Sync now" used to call /api/cron/refresh-navs and /api/cron/refresh-gold from
// the browser. Those routes gate on CRON_SECRET in an Authorization header a
// browser fetch never sends, so both returned 401 and the button reported
// "Sync failed" on every click, for every user (#552).
//
// The previous tests here asserted those exact cron URLs — encoding the broken
// wiring rather than catching it, because a URL assertion can't see that the
// request is unauthenticated. These assert the user-scoped endpoints instead,
// which authenticate by session cookie and act on the caller's own data.
const ok = (status = 200) => ({ ok: true, status, headers: new Headers() })
const notOk = (status: number, headers: Record<string, string> = {}) =>
  ({ ok: false, status, headers: new Headers(headers) })

describe('refreshPrices', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calls the user-scoped refresh endpoints, not the cron routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    await refreshPrices()

    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toEqual(
      expect.arrayContaining(['/api/v1/funds/refresh-nav', '/api/v1/gold-price/refresh']),
    )
    expect(urls.some((u: string) => u.includes('/api/cron/'))).toBe(false)
  })

  it('posts, since both endpoints write', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    await refreshPrices()
    for (const call of fetchMock.mock.calls) {
      expect(call[1]?.method).toBe('POST')
    }
  })

  it('reports success when both endpoints succeed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    await expect(refreshPrices()).resolves.toEqual({ ok: true })
  })

  it('reports a plain failure when an endpoint errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(notOk(500)))
    await expect(refreshPrices()).resolves.toEqual({ ok: false, reason: 'error' })
  })

  // A rate-limited sync is the user's own doing and clears itself — telling them
  // to wait is actionable in a way "Sync failed" isn't.
  it('distinguishes a rate-limited sync and carries Retry-After', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(notOk(429, { 'Retry-After': '42' })))
    await expect(refreshPrices()).resolves.toEqual({
      ok: false,
      reason: 'rate-limited',
      retryAfterSeconds: 42,
    })
  })

  it('prefers the rate-limit reason when one endpoint is limited and the other fails', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(notOk(500))
      .mockResolvedValueOnce(notOk(429, { 'Retry-After': '30' })))
    const res = await refreshPrices()
    expect(res).toMatchObject({ ok: false, reason: 'rate-limited' })
  })

  it('falls back to a sane retry window when Retry-After is missing', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(notOk(429)))
    const res = await refreshPrices()
    expect(res).toMatchObject({ ok: false, reason: 'rate-limited' })
    expect((res as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0)
  })

  it('reports failure (without throwing) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    await expect(refreshPrices()).resolves.toEqual({ ok: false, reason: 'error' })
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
