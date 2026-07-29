'use client'

import { useSyncExternalStore } from 'react'

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
