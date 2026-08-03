'use client'

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'

type Theme = 'light' | 'dark'
export type ThemeChoice = Theme | 'system'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  setTheme: (choice: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

// The resolved theme is derived from localStorage and the OS preference — state
// this component reads rather than owns, so the store is those two and not a
// useState. Seeding it inside an effect (#537) meant the first paint was always
// 'light' and corrected a frame later.
//
// A lazy initializer isn't an option: there is no localStorage during SSR, so
// the server and client would disagree and hydration would break.
// useSyncExternalStore is built for that split — a client snapshot plus a
// separate server one, which stays 'light' exactly as the markup assumed before.
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', onChange)
  // Another tab changing the choice should move this one too.
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    mq.removeEventListener('change', onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getSnapshot(): Theme {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark() ? 'dark' : 'light'
}

const getServerSnapshot = (): Theme => 'light'

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeState = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // The <html> class mirrors the resolved theme. Doing it here rather than in
  // each setter keeps one source of truth — and it's a DOM write, not state, so
  // an effect is the right place for it.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', themeState === 'dark')
  }, [themeState])

  function toggleTheme() {
    applyTheme(themeState === 'dark' ? 'light' : 'dark')
  }

  // Writing the choice IS the state change now: the snapshot reads it back, and
  // emit() tells every subscriber to re-read. 'system' is the absence of a
  // stored value, so the snapshot falls through to the OS — which is also why
  // the theme now follows a later OS change instead of freezing at mount.
  function applyTheme(choice: ThemeChoice) {
    if (choice === 'system') localStorage.removeItem('theme')
    else localStorage.setItem('theme', choice)
    emit()
  }

  return (
    <ThemeContext.Provider value={{ theme: themeState, toggleTheme, setTheme: applyTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
