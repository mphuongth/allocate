'use client'

import { useState, useSyncExternalStore } from 'react'

// The store never changes, so nothing ever needs to be notified. Defined at
// module scope because useSyncExternalStore re-subscribes whenever `subscribe`
// changes identity, and an inline arrow would change it on every render.
const subscribe = () => () => {}
const onClient = () => true
const onServer = () => false

/**
 * `false` while the server renders and during the client's hydration render,
 * `true` from the first render after hydration.
 *
 * This is the safe way to branch on anything the server cannot see —
 * localStorage above all. Reading such a value from a `useState` initialiser
 * looks equivalent but is not: initialisers run during the hydration render, so
 * a warm cache makes the client's tree disagree with the server HTML and React
 * throws the subtree away and rebuilds it (#560).
 *
 * `getServerSnapshot` returning `false` is what makes hydration match;
 * `getSnapshot` returning `true` is what schedules the follow-up render where
 * the client-only value can safely be adopted.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer)
}

/**
 * Read a client-only cache without breaking hydration, then hand it to `adopt`
 * exactly once, on the first render after hydration.
 *
 * Two orderings make this easy to get wrong, which is why it lives here instead
 * of being repeated at each call site:
 *
 * 1. **The read must happen during the first render, not at adoption time.** The
 *    follow-up render is scheduled from React's passive-effect flush, and React
 *    drains the rest of that flush before processing it — so any mount effect
 *    that clears the cache (a refetch calling bustCache()) runs first. Reading
 *    late silently finds nothing and disables the cache entirely.
 * 2. **`adopt` must not clobber fresher data.** It runs after mount effects have
 *    started, so a fast refetch may already have landed. Callers should apply the
 *    cached value with a functional update, or guard on a still-loading flag.
 *
 * `adopt` is called during render, so it may only adjust state — the pattern
 * React documents for deriving state from a changed input.
 */
export function useAdoptCacheOnce<T>(read: () => T | null, adopt: (cached: T) => void): void {
  const [snapshot] = useState(read)
  const hydrated = useHydrated()
  const [done, setDone] = useState(false)

  if (hydrated && !done) {
    setDone(true)
    if (snapshot !== null && snapshot !== undefined) adopt(snapshot)
  }
}
