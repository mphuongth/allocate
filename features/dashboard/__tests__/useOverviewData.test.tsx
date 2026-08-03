import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOverviewData } from '../useOverviewData'
import type { DashboardData } from '../contracts'

// The dashboard's data-loading owner, lifted out of DashboardClient (#602).
// It carries the whole load lifecycle — cache-first paint, skeleton vs. silent
// refresh, the error banner, and the PWA-only staleness rules — which the page
// previously spread across five effects and eight useState calls.

const payload = (netWorth: number): DashboardData => ({
  netWorth: {
    totalAssets: netWorth, totalLiabilities: 0, netWorth, totalInvested: 0, currentValue: 0,
    overallProfitLoss: 0, overallProfitLossPercentage: 0, navStale: false, hasGold: false,
    navUpdatedAt: null,
  },
  goals: [], unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 0, gold: 0, stock: 0 }, insurance: [],
})

const okResponse = (body: DashboardData) =>
  ({ ok: true, status: 200, json: async () => body }) as Response

beforeEach(() => {
  localStorage.clear()
  // Not a PWA in these tests unless a case says otherwise — the standalone
  // branches add their own listeners and would leak across cases.
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useOverviewData', () => {
  it('loads on mount and clears the skeleton', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(payload(500))))
    const { result } = renderHook(() => useOverviewData('u1', 'Something went wrong'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.netWorth.netWorth).toBe(500)
    expect(result.current.error).toBe('')
  })

  it('surfaces an error when the load fails and no cache can cover it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => useOverviewData('u1', 'Something went wrong'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Something went wrong')
    expect(result.current.data).toBeNull()
  })

  it('refreshes silently once data is on screen — no second skeleton', async () => {
    // The distinction that matters to the user: `loading` paints the full
    // skeleton, `refreshing` is the number-pulse. A refresh over visible data
    // must never blank the page.
    const fetchMock = vi.fn().mockResolvedValue(okResponse(payload(500)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useOverviewData('u1', 'error'))
    await waitFor(() => expect(result.current.data).not.toBeNull())

    fetchMock.mockResolvedValue(okResponse(payload(900)))
    let done!: Promise<void>
    act(() => { done = result.current.refresh({ force: true }) })
    expect(result.current.loading).toBe(false)
    await act(async () => { await done })
    expect(result.current.data?.netWorth.netWorth).toBe(900)
  })

  it('serves the cached snapshot without a network call, and force skips it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(payload(500)))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useOverviewData('u1', 'error'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    const afterFirstLoad = fetchMock.mock.calls.length

    await act(async () => { await result.current.refresh() })
    expect(fetchMock.mock.calls.length).toBe(afterFirstLoad) // cache hit, no request

    fetchMock.mockResolvedValue(okResponse(payload(900)))
    await act(async () => { await result.current.refresh({ force: true }) })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirstLoad)
    expect(result.current.data?.netWorth.netWorth).toBe(900)
  })

  it('bumps historyKey on every successful load so the chart refetches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(payload(500))))
    const { result } = renderHook(() => useOverviewData('u1', 'error'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    const first = result.current.historyKey

    await act(async () => { await result.current.refresh({ force: true }) })
    expect(result.current.historyKey).toBeGreaterThan(first)
  })

  it('records the fetch time only for a real network load', async () => {
    // The PWA foreground check reads this. Stamping it on a stale-cache
    // fallback would suppress the next genuine refetch.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(payload(500))))
    const { result } = renderHook(() => useOverviewData('u1', 'error'))
    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(localStorage.getItem('pwa_last_fetch')).not.toBeNull()
  })
})
