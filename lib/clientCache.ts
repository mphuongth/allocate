// Client-side cache lifecycle for the signed-in account.
//
// Two caches hold per-account data: localStorage (page-level snapshots) and the
// service worker's Cache Storage (`api-v1-*`, `pages-*`). Both are keyed by URL
// or page, never by user, so on a shared browser profile they have to be wiped
// when the account changes — otherwise the worker can hand user B a cached
// response belonging to user A (#565).
//
// The worker's half of the contract lives in public/sw.js.

// localStorage cache keys cleared on sign-out so the next account never sees
// the previous user's stale data.
const APP_CACHE_PREFIXES = [
  'dashboardOverviewCache',
  'planningCache_',
  'savingsGoalsCache',
  'fixedExpensesCache',
  'insuranceMembersCache',
  'fundLibraryCache',
]

// Cache Storage names holding authenticated responses, plus the worker's record
// of who they belong to. Matched by prefix so a CACHE_VERSION bump in sw.js
// doesn't silently leave a cache behind here. `static-assets-*` is excluded on
// purpose: chunks, images and fonts are identical for every account.
const SW_USER_CACHE_PREFIXES = ['api-v1-', 'pages-', 'cache-owner-']

function getServiceWorkerContainer(): ServiceWorkerContainer | null {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  return navigator.serviceWorker
}

/**
 * Tell the service worker which account owns the authenticated caches. Called on
 * every auth-state change; the worker wipes those caches whenever the id differs
 * from the one it recorded, which covers logging in as a different user after a
 * session expiry (no sign-out ever runs in that flow).
 */
export async function announceCacheOwner(userId: string): Promise<void> {
  const container = getServiceWorkerContainer()
  if (!container) return

  // Before the first activation the page isn't controlled yet, so fall back to
  // the registration's active worker once it's ready.
  const worker = container.controller ?? (await container.ready).active
  worker?.postMessage({ type: 'SET_CACHE_OWNER', userId })
}

/**
 * Drop every cached artefact of the current account. Awaited on sign-out before
 * routing to the login page, so nothing survives into the next session.
 *
 * Cache Storage is deleted from the page rather than through the worker: the
 * page has the same access, and a `postMessage` to a worker that may not be
 * controlling this page yet would leave the purge unobservable. The message is
 * still sent so a live worker forgets the owner it is holding in flight.
 */
export async function clearAppCaches(): Promise<void> {
  clearLocalAppCaches()
  getServiceWorkerContainer()?.controller?.postMessage({ type: 'CLEAR_CACHE_OWNER' })
  await clearServiceWorkerCaches()
}

function clearLocalAppCaches(): void {
  if (typeof localStorage === 'undefined') return
  Object.keys(localStorage)
    .filter((k) => APP_CACHE_PREFIXES.some((p) => k.startsWith(p)))
    .forEach((k) => localStorage.removeItem(k))
}

async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const names = await caches.keys()
    await Promise.all(
      names
        .filter((name) => SW_USER_CACHE_PREFIXES.some((p) => name.startsWith(p)))
        .map((name) => caches.delete(name)),
    )
  } catch {
    // Cache Storage is unavailable (private mode, http origin). The localStorage
    // clear above still happened, and without Cache Storage the worker has no
    // cached responses to leak.
  }
}
