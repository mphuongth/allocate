// One answer to "the session this tab is showing is gone".
//
// Two tabs share one cookie jar, so signing out in one ends the session in all
// of them — but the other tabs never noticed. They kept rendering the data they
// had, and the next fetch came back 401, which every caller turns into the same
// inline "couldn't load data — try again" (#719). That message is wrong twice:
// it blames the network, and it offers a retry that can only ever 401 again.
//
// So expiry is app-level state, reported from wherever it is first seen — a
// Supabase auth event, or any API answering 401 — and answered once, by the
// blocking dialog in components/layout/SessionExpiredGate.tsx.

import { useSyncExternalStore } from 'react'

let expired = false
let selfSignOut = false
const listeners = new Set<() => void>()

/**
 * The session this tab was using is no longer valid. Safe to call repeatedly and
 * from anywhere; only the first call in a tab does anything.
 */
export function reportSessionExpired(): void {
  // The tab that pressed "sign out" is already navigating to the login page
  // under its own steam. Telling it its session ended would be a second,
  // contradictory answer to an action the user took on purpose.
  if (expired || selfSignOut) return
  expired = true
  listeners.forEach((l) => l())
}

/**
 * Called by the sign-out handler *before* it clears the session, so this tab
 * stays quiet while every other tab gets the dialog.
 */
export function markSelfSignOut(): void {
  selfSignOut = true
}

/**
 * The sign-out did not happen after all. The session is still live, so a later
 * expiry in this tab is once again news the user needs.
 */
export function cancelSelfSignOut(): void {
  selfSignOut = false
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** True once the session ended under this tab. Server snapshot is always false. */
export function useSessionExpired(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => expired,
    () => false,
  )
}

/** Module state outlives a test file; each test starts from a live session. */
export function resetSessionExpiry(): void {
  expired = false
  selfSignOut = false
  listeners.clear()
}

/**
 * The API path of a fetch aimed at this app's own API, or null for anything
 * else. Supabase's own endpoints answer 401 for a wrong password — a failed
 * sign-in, not a session that ended — so origin and prefix both have to match.
 */
function appApiPath(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  try {
    const url = new URL(raw, window.location.href)
    if (url.origin !== window.location.origin) return null
    return url.pathname.startsWith('/api/') ? url.pathname : null
  } catch {
    return null
  }
}

let watching = false

/**
 * Notice a 401 from any of the app's ~90 client fetches, and report it.
 *
 * Deliberately an observer rather than an `apiFetch()` every caller must
 * remember to use: the failure mode of a wrapper is a call site that forgot it,
 * which is exactly the silence this exists to end. Responses pass through
 * untouched, so no caller's error handling changes — the dialog simply arrives
 * over the top of whatever they render.
 *
 * Returns a teardown that puts the original fetch back.
 */
export function watchApiUnauthorized(): () => void {
  if (typeof window === 'undefined' || watching) return () => {}
  const original = window.fetch
  watching = true

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init)
    if (res.status === 401 && appApiPath(input) !== null) reportSessionExpired()
    return res
  }

  return () => {
    window.fetch = original
    watching = false
  }
}

/**
 * Where to send the user back to after they sign in again — or null when the
 * candidate is not a path within this app. `//host` and `/\host` are both
 * protocol-relative URLs to browsers, so a bare "starts with /" is not enough.
 */
export function safeNextPath(candidate: string | null): string | null {
  if (!candidate || !candidate.startsWith('/')) return null
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null
  return candidate
}
