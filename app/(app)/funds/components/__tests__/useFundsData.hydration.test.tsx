import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useFundsData } from '../useFundsData'

// #560: the fund count hydrated as "1 quỹ" against server HTML that said
// "0 quỹ", so React discarded the whole /funds subtree and re-rendered it.
//
// The cause was reading localStorage from a useState initialiser. Those run
// during the *hydration* render, and the server has no localStorage — so a warm
// cache guaranteed the two renders disagreed.
//
// The contract this pins: the first render must produce what the server
// produced, whatever the cache holds. Adopting the cache one render later is
// what makes it safe, and costs nothing that React wasn't already paying — a
// mismatch regenerates the subtree anyway.

const CACHE_KEY = 'fundLibraryCache'
const CACHED = [{ id: 'cached-1', name: 'Cached Fund', code: 'CF', fund_type: 'stock', nav: 1 }]
const SERVED = [
  { id: 'served-1', name: 'Served Fund A', code: 'SFA', fund_type: 'stock', nav: 2 },
  { id: 'served-2', name: 'Served Fund B', code: 'SFB', fund_type: 'stock', nav: 3 },
]

type Snapshot = { loading: boolean; ids: string[] }
let renders: Snapshot[] = []

function Probe() {
  const { funds, loading } = useFundsData()
  renders.push({ loading, ids: funds.map((f) => (f as { id: string }).id) })
  return null
}

describe('useFundsData — hydration safety (#560)', () => {
  beforeEach(() => {
    renders = []
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/funds')) {
        return new Response(JSON.stringify({ funds: SERVED }), { status: 200 })
      }
      return new Response(JSON.stringify({ goals: [] }), { status: 200 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('first render matches the server even when the cache is warm', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: CACHED, ts: Date.now() }))

    render(<Probe />)

    // The server renders an empty, loading list because it cannot see the cache.
    // If the client's first render disagrees, that is the mismatch — asserting on
    // renders[0] rather than the settled state is the whole point of this test.
    expect(renders[0]).toEqual({ loading: true, ids: [] })
  })

  it('still adopts the cache immediately after hydration', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: CACHED, ts: Date.now() }))

    render(<Probe />)

    // The cache must not be abandoned — it exists to avoid a loading flash while
    // the refetch is in flight. It just arrives one render later than before.
    const cacheAdopted = renders.find((r) => r.ids.length === 1 && r.ids[0] === 'cached-1')
    expect(cacheAdopted, 'expected a render showing the cached fund').toBeDefined()
    expect(cacheAdopted!.loading).toBe(false)

    await waitFor(() => {
      expect(renders[renders.length - 1].ids).toEqual(['served-1', 'served-2'])
    })
  })

  it('starts empty and loading when there is no cache', () => {
    render(<Probe />)
    expect(renders[0]).toEqual({ loading: true, ids: [] })
  })

  it('ignores a cache past its TTL', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ data: CACHED, ts: Date.now() - 5 * 60 * 1000 }),
    )

    render(<Probe />)

    expect(renders.every((r) => !r.ids.includes('cached-1'))).toBe(true)
  })
})
