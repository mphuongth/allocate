'use client'

import { createContext, useContext, useEffect, useState } from 'react'

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

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeState, setThemeState] = useState<Theme>('light')

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme | null
    const resolved = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    setThemeState(resolved)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [])

  function toggleTheme() {
    applyTheme(themeState === 'dark' ? 'light' : 'dark')
  }

  function applyTheme(choice: ThemeChoice) {
    if (choice === 'system') {
      localStorage.removeItem('theme')
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const resolved: Theme = isDark ? 'dark' : 'light'
      setThemeState(resolved)
      document.documentElement.classList.toggle('dark', isDark)
    } else {
      setThemeState(choice)
      localStorage.setItem('theme', choice)
      document.documentElement.classList.toggle('dark', choice === 'dark')
    }
  }

  return (
    <ThemeContext.Provider value={{ theme: themeState, toggleTheme, setTheme: applyTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
