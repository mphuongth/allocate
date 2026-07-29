import { describe, it, expect } from 'vitest'
import { act, useEffect, useState } from 'react'
import { render } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useHydrated, useAdoptCacheOnce } from '../useHydrated'

// #560. The whole value of this hook is the *first* value it returns, so that is
// what these tests assert. A hook that only ever settled on `true` would look
// identical under a naive test and would not prevent a single mismatch.

let renders: boolean[] = []

function Probe() {
  const hydrated = useHydrated()
  renders.push(hydrated)
  return <span>{String(hydrated)}</span>
}

describe('useHydrated (#560)', () => {
  it('renders false on the server', () => {
    expect(renderToString(<Probe />)).toContain('false')
  })

  it('is false for the hydration render, then true', async () => {
    // This has to hydrate for real. A plain client-side render never consults
    // getServerSnapshot, so it would report true from the first render and prove
    // nothing about the case the hook exists for.
    const container = document.createElement('div')
    container.innerHTML = renderToString(<Probe />)
    document.body.appendChild(container)

    renders = []
    await act(async () => {
      hydrateRoot(container, <Probe />)
    })

    expect(renders[0], 'hydration render must agree with the server').toBe(false)
    expect(renders[renders.length - 1], 'must flip after hydration').toBe(true)
    // A getSnapshot returning a fresh value each call would re-render forever.
    expect(renders.slice(1).every((v) => v === true)).toBe(true)

    container.remove()
  })

  it('is true from the first render on a client-only mount', () => {
    // Documenting the asymmetry deliberately: with no server HTML to match,
    // there is nothing to disagree with, so React uses getSnapshot immediately.
    // Anyone reading only the test above could mistake false-first for a
    // universal guarantee and write a component that relies on it.
    renders = []
    render(<Probe />)
    expect(renders[0]).toBe(true)
  })
})

describe('useAdoptCacheOnce (#560)', () => {
  it('adopts a cache that a mount effect has already cleared', async () => {
    // The ordering that broke the first version of this fix, found in review.
    // The adoption render is scheduled from React's passive-effect flush, and
    // React drains the rest of that flush before processing it — so a mount
    // effect that clears the source runs first. Reading the cache at adoption
    // time therefore always found nothing, silently disabling it.
    //
    // Reading `store` inside the effect below is what makes this a real test of
    // the ordering rather than of the return value: if the hook ever goes back
    // to reading late, `adopted` stays null and this fails.
    let store: string | null = 'cached-value'
    const adopted: Array<string | null> = []

    function Consumer() {
      const [value, setValue] = useState<string | null>(null)
      useAdoptCacheOnce(
        () => store,
        (cached) => setValue(cached),
      )
      // Stands in for the mount refetch, whose first act is to bust the cache.
      useEffect(() => {
        store = null
      }, [])
      adopted.push(value)
      return <span>{value ?? 'none'}</span>
    }

    const container = document.createElement('div')
    container.innerHTML = renderToString(<Consumer />)
    document.body.appendChild(container)

    await act(async () => {
      hydrateRoot(container, <Consumer />)
    })

    expect(adopted[0], 'hydration render must not use the cache').toBeNull()
    expect(adopted[adopted.length - 1], 'cache was cleared before adoption').toBe('cached-value')

    container.remove()
  })

  it('does not call adopt when there is no cache', async () => {
    let calls = 0

    function Consumer() {
      useAdoptCacheOnce<string>(
        () => null,
        () => { calls++ },
      )
      return <span>ok</span>
    }

    const container = document.createElement('div')
    container.innerHTML = renderToString(<Consumer />)
    document.body.appendChild(container)

    await act(async () => {
      hydrateRoot(container, <Consumer />)
    })

    expect(calls).toBe(0)
    container.remove()
  })

  it('adopts exactly once even across later re-renders', async () => {
    let calls = 0
    let bump: (() => void) | null = null

    function Consumer() {
      const [, setTick] = useState(0)
      bump = () => setTick((n) => n + 1)
      useAdoptCacheOnce(
        () => 'v',
        () => { calls++ },
      )
      return <span>ok</span>
    }

    const container = document.createElement('div')
    container.innerHTML = renderToString(<Consumer />)
    document.body.appendChild(container)

    await act(async () => {
      hydrateRoot(container, <Consumer />)
    })
    await act(async () => { bump!() })
    await act(async () => { bump!() })

    expect(calls).toBe(1)
    container.remove()
  })
})
