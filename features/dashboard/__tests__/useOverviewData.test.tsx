import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOverviewData } from '../useOverviewData'
import { setCachedOverview } from '../overviewData'
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

// Opening the app after it has sat idle is when the backend is slowest: measured
// on production, the overview took 5–10 s on the first call after ~20 minutes
// against ~0.2 s warm. Until now that wait was spent looking at a skeleton, because
// a snapshot past its TTL (or, in the PWA, older than 30 s) was thrown away before
// the request even started. The last snapshot is the better thing to look at:
// paint it at once, refresh behind it with the number pulse.
describe('useOverviewData — the last snapshot paints first', () => {
  /** Store a snapshot for u1 as if it had been fetched `ageMs` ago. */
  function seedSnapshot(netWorth: number, ageMs: number) {
    setCachedOverview('u1', payload(netWorth))
    for (const key of Object.keys(localStorage)) {
      const entry = JSON.parse(localStorage.getItem(key)!)
      localStorage.setItem(key, JSON.stringify({ ...entry, ts: Date.now() - ageMs }))
    }
  }

  /** A fetch that stays pending until the test settles it. */
  function pendingFetch() {
    let settle!: (res: Response) => void
    let fail!: (err: Error) => void
    const fetchMock = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve, reject) => { settle = resolve; fail = reject }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return { fetchMock, settle: (res: Response) => settle(res), fail: (err: Error) => fail(err) }
  }

  const TEN_MINUTES = 10 * 60 * 1000

  it('shows an expired snapshot at once, then replaces it with the fresh load', async () => {
    seedSnapshot(500, TEN_MINUTES)
    const net = pendingFetch()
    const { result } = renderHook(() => useOverviewData('u1', 'error'))

    // The request is still in flight: the old figure is on screen, not a skeleton,
    // and the pulse says a newer one is coming.
    await waitFor(() => expect(result.current.data?.netWorth.netWorth).toBe(500))
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(true)
    expect(net.fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { net.settle(okResponse(payload(900))) })
    await waitFor(() => expect(result.current.data?.netWorth.netWorth).toBe(900))
    expect(result.current.refreshing).toBe(false)
  })

  it('does the same in the installed app, where a 30 s old snapshot used to be discarded', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    seedSnapshot(500, 60_000)
    localStorage.setItem('pwa_last_fetch', String(Date.now() - 60_000))
    const net = pendingFetch()
    const { result } = renderHook(() => useOverviewData('u1', 'error'))

    await waitFor(() => expect(result.current.data?.netWorth.netWorth).toBe(500))
    expect(result.current.loading).toBe(false)
    // Still a real refetch — the staleness rule decides whether to ask, not what to show.
    expect(net.fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { net.settle(okResponse(payload(900))) })
    await waitFor(() => expect(result.current.data?.netWorth.netWorth).toBe(900))
  })

  it('keeps the old snapshot on screen, without an error, when the refresh fails', async () => {
    seedSnapshot(500, TEN_MINUTES)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { result } = renderHook(() => useOverviewData('u1', 'Something went wrong'))

    await waitFor(() => expect(result.current.data?.netWorth.netWorth).toBe(500))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current.data?.netWorth.netWorth).toBe(500)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('')
  })

  it('does not count the old snapshot as a fetch', async () => {
    // pwa_last_fetch drives the foreground-staleness check. Stamping it when the
    // old snapshot paints would tell the app it had just loaded fresh numbers.
    seedSnapshot(500, TEN_MINUTES)
    pendingFetch()
    const { result } = renderHook(() => useOverviewData('u1', 'error'))

    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(localStorage.getItem('pwa_last_fetch')).toBeNull()
  })

  it('never shows another account\'s snapshot', async () => {
    seedSnapshot(500, TEN_MINUTES)
    pendingFetch()
    const { result } = renderHook(() => useOverviewData('u2', 'error'))

    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.data).toBeNull()
  })
})
