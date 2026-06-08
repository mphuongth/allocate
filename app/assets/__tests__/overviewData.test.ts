import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  loadOverview,
  overviewErrorText,
  getCachedOverview,
  setCachedOverview,
  type OverviewLoadResult,
} from '../overviewData'
import type { DashboardData } from '../DashboardClient'

const sample = (assets: number): DashboardData =>
  ({
    netWorth: {
      totalAssets: assets,
      totalLiabilities: 0,
      netWorth: assets,
      totalInvested: assets,
      currentValue: assets,
      overallProfitLoss: 0,
      overallProfitLossPercentage: 0,
      navStale: false,
      hasGold: false,
      navUpdatedAt: null,
    },
    goals: [],
    unallocated: { totalValue: 0, funds: [], nonFunds: [] },
    byType: { bank: 0, gold: 0, stock: 0 },
    insurance: [],
  }) as DashboardData

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// The service worker's synthetic abort response for a slow /api/v1 request.
const swOffline = () => jsonResponse({ error: 'Offline', cached: false }, 503)

describe('loadOverview', () => {
  const noCache = { getCache: () => null, setCache: () => {} }

  it('returns and caches the data on a 200', async () => {
    const data = sample(100)
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(data))
    const setCache = vi.fn()

    const result = await loadOverview({ fetchFn: fetchFn as never, getCache: () => null, setCache })

    expect(result.data).toEqual(data)
    expect(result.error).toBeNull()
    expect(result.fromCache).toBe(false)
    expect(setCache).toHaveBeenCalledWith(data)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('retries once on a transient 503 and then succeeds', async () => {
    const data = sample(200)
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(swOffline())
      .mockResolvedValueOnce(jsonResponse(data))

    const result = await loadOverview({ fetchFn: fetchFn as never, ...noCache })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual(data)
    expect(result.error).toBeNull()
  })

  it('falls back to the stale cache when retries are exhausted (no error surfaced)', async () => {
    const cached = sample(300)
    const fetchFn = vi.fn().mockResolvedValue(swOffline())

    const result = await loadOverview({
      fetchFn: fetchFn as never,
      getCache: (allowStale) => (allowStale ? cached : null),
      setCache: () => {},
    })

    expect(fetchFn).toHaveBeenCalledTimes(2) // initial + 1 retry
    expect(result.data).toEqual(cached)
    expect(result.fromCache).toBe(true)
    expect(result.transient).toBe(true)
  })

  it('reports a transient error only when there is no cache to fall back to', async () => {
    const fetchFn = vi.fn().mockResolvedValue(swOffline())

    const result = await loadOverview({ fetchFn: fetchFn as never, ...noCache })

    expect(result.data).toBeNull()
    expect(result.transient).toBe(true)
  })

  it('retries on a network rejection, then falls back to cache', async () => {
    const cached = sample(400)
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await loadOverview({
      fetchFn: fetchFn as never,
      getCache: () => cached,
      setCache: () => {},
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual(cached)
    expect(result.fromCache).toBe(true)
  })

  it('does not retry a non-transient 4xx and surfaces its error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401))

    const result = await loadOverview({ fetchFn: fetchFn as never, ...noCache })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(result.transient).toBe(false)
    expect(result.error).toBe('Unauthorized')
  })
})

describe('overviewErrorText', () => {
  const base: OverviewLoadResult = { data: null, error: null, transient: false, fromCache: false }

  it('shows no banner when data is present (even from stale cache)', () => {
    const result = { ...base, data: sample(1), transient: true, fromCache: true }
    expect(overviewErrorText(result, 'Có lỗi xảy ra')).toBeNull()
  })

  it('never surfaces the raw "Offline" string for a transient failure', () => {
    const result = { ...base, error: 'Offline', transient: true }
    expect(overviewErrorText(result, 'Có lỗi xảy ra')).toBe('Có lỗi xảy ra')
  })

  it('surfaces a real (non-transient) server error message', () => {
    const result = { ...base, error: 'Failed to fetch dashboard data', transient: false }
    expect(overviewErrorText(result, 'Có lỗi xảy ra')).toBe('Failed to fetch dashboard data')
  })
})

describe('getCachedOverview / setCachedOverview', () => {
  const userId = 'user-1'
  beforeEach(() => localStorage.clear())

  it('returns null for an entry past its TTL unless stale is allowed', () => {
    const data = sample(500)
    // Hand-write an entry with an old timestamp.
    localStorage.setItem(
      `dashboardOverviewCache_${userId}`,
      JSON.stringify({ data, ts: Date.now() - 10 * 60 * 1000 }),
    )

    expect(getCachedOverview(userId)).toBeNull()
    expect(getCachedOverview(userId, { allowStale: true })).toEqual(data)
  })

  it('round-trips a fresh entry', () => {
    const data = sample(600)
    setCachedOverview(userId, data)
    expect(getCachedOverview(userId)).toEqual(data)
  })
})
