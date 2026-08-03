'use client'

import { useCallback, useEffect, useRef } from 'react'

// A status flash can outlive the thing that started it — a sync result, a
// "Saved" confirmation. Keep one timeout per owner and clear it on unmount so
// React never receives a late setState after a route change or a test has torn
// the view down. Scheduling again replaces the pending timeout rather than
// stacking a second one.
//
// Lived inside MobileSettingsView; desktop used a bare setTimeout and leaked
// (#570). Shared so both views get the cleanup, and moved here from the settings
// route when the profile editor became a feature module (#603) — it knows
// nothing about settings, so under docs/architecture.md it is a UI primitive.
export function useManagedTimeout() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
  }, [])

  return useCallback((callback: () => void, delay: number) => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      callback()
    }, delay)
  }, [])
}
