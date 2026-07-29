import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useFundsData } from '../useFundsData'

// Real hydration, not a client-only render.
//
// The client-only tests in useFundsData.hydration.test.tsx cannot see the
// ordering that matters here: with no server HTML, useHydrated() is already
// `true` on the first render, so the cache is adopted before any effect runs.
// Under real hydration it starts `false`, and the follow-up render is scheduled
// from the passive-effect flush — the same flush that runs the mount reload()
// effect, whose first act is bustCache(). Whether the adoption or the bust wins
// is the whole question, and only a hydrating test can answer it.

const CACHE_KEY = 'fundLibraryCache'
const CACHED = [{ id: 'cached-1', name: 'Cached Fund', code: 'CF', fund_type: 'stock', nav: 1 }]

let renders: Array<{ loading: boolean; error: boolean; ids: string[] }> = []

function Probe() {
  const { funds, loading, error } = useFundsData()
  renders.push({ loading, error, ids: funds.map((f) => (f as { id: string }).id) })
  return <span>{funds.length}</span>
}

async function hydrateProbe() {
  const container = document.createElement('div')
  container.innerHTML = renderToString(<Probe />)
  document.body.appendChild(container)
  renders = []
  await act(async () => {
    hydrateRoot(container, <Probe />)
  })
  return container
}

describe('useFundsData — cache survives hydration ordering (#560)', () => {
  beforeEach(() => {
    renders = []
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('shows the cached funds while the refetch is still in flight', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: CACHED, ts: Date.now() }))
    // Never settles, so the only thing that can put funds on screen is the cache.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

    await hydrateProbe()

    expect(renders[0], 'hydration render must match the server').toEqual({
      loading: true,
      error: false,
      ids: [],
    })
    expect(
      renders[renders.length - 1].ids,
      'cache was never adopted — the reload effect busted it first',
    ).toEqual(['cached-1'])
  })

  it('falls back to the cached list when the refetch fails', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: CACHED, ts: Date.now() }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await hydrateProbe()

    // A hook-level contract, deliberately not a claim about the screen: the
    // views hide the list whenever `error` is set, so the user sees the error
    // panel either way. What matters here is that the data is still in hand for
    // a retry or a view that chooses to show it, exactly as before this change.
    const last = renders[renders.length - 1]
    expect(last.error).toBe(true)
    expect(last.ids, 'the cached list was discarded on a failed refetch').toEqual(['cached-1'])
  })
})
