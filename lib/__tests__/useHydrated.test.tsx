import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { render } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { useHydrated } from '../useHydrated'

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
