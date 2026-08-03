import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import ThemeProvider, { useTheme } from '../ThemeProvider'

// The resolved theme comes from localStorage and the OS preference — state this
// component reads rather than owns. It used to seed that with setThemeState()
// inside an effect (#537), which meant the value was always 'light' for the
// first paint and corrected a frame later.
//
// The seeding can't move into a lazy initializer: there is no localStorage
// during SSR, so the server and client would disagree and hydration would break.
// useSyncExternalStore is the tool that handles exactly that split — a client
// snapshot and a separate server snapshot.

let mqMatches = false
const mqListeners = new Set<() => void>()

function stubMatchMedia() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('dark') ? mqMatches : false,
    media: q,
    addEventListener: (_: string, cb: () => void) => { mqListeners.add(cb) },
    removeEventListener: (_: string, cb: () => void) => { mqListeners.delete(cb) },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

const setOsDark = (v: boolean) => act(() => {
  mqMatches = v
  mqListeners.forEach((l) => l())
})

function Probe() {
  const { theme, toggleTheme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setTheme('dark')}>dark</button>
    </div>
  )
}

const renderProvider = () => render(<ThemeProvider><Probe /></ThemeProvider>)

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    mqMatches = false
    mqListeners.clear()
    document.documentElement.classList.remove('dark')
    stubMatchMedia()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('falls back to the OS preference when nothing is stored', () => {
    mqMatches = true
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  // The effect-seeded version rendered 'light' first and corrected afterwards.
  it('resolves a stored theme on the first render, not a frame later', () => {
    localStorage.setItem('theme', 'dark')
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  it('a stored choice wins over the OS preference', () => {
    mqMatches = true
    localStorage.setItem('theme', 'light')
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })

  it('mirrors the resolved theme onto the document element', () => {
    localStorage.setItem('theme', 'dark')
    renderProvider()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('persists an explicit choice and applies it', () => {
    renderProvider()
    act(() => { screen.getByText('dark').click() })
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles between the two', () => {
    renderProvider()
    act(() => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    act(() => { screen.getByText('toggle').click() })
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })

  it('"system" clears the stored choice and follows the OS', () => {
    localStorage.setItem('theme', 'light')
    mqMatches = true
    renderProvider()
    act(() => { screen.getByText('system').click() })
    expect(localStorage.getItem('theme')).toBeNull()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  // Only meaningful once the store is the source of truth: with the old effect
  // this never updated after mount.
  it('follows a later OS change while on "system"', () => {
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
    setOsDark(true)
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })
})
