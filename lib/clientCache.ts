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
 * Source for an inline script that claims cache ownership during HTML parsing.
 *
 * React effects cannot win this race: effects run child-first, so a page's data
 * fetch starts before the layout's announcement. Running it as an inline script
 * puts ownership in place before hydration and before any fetch — and covers
 * entries no client code precedes, such as the email-confirmation callback
 * redirecting straight to /dashboard (#565).
 *
 * Fire-and-forget: with no controller there is no worker holding a partition,
 * so there is nothing to correct. The effect in CacheOwnerAnnouncer still runs
 * and handles every later auth-state change.
 */
export function buildCacheOwnerScript(userId: string): string {
  // Serialised as data, with `<` escaped so the payload can't close the script
  // element — the id reaches us from the session, not from source we control.
  const payload = JSON.stringify({ type: 'SET_CACHE_OWNER', userId }).replace(/</g, '\\u003c')
  return `try{navigator.serviceWorker.controller.postMessage(${payload})}catch(e){}`
}

// How long to wait for the worker to confirm an ownership change before giving
// up. Only a safety valve: the work is a couple of Cache Storage deletes, and a
// worker that never replies must not leave the caller hanging.
const OWNER_ACK_TIMEOUT_MS = 3_000

/**
 * Tell the service worker which account owns the authenticated caches. Called as
 * soon as the authenticated layout mounts and on every later auth-state change;
 * the worker wipes those caches whenever the id differs from the one it
 * recorded, which covers logging in as a different user after a session expiry
 * (no sign-out ever runs in that flow).
 *
 * Resolves once the worker has *finished* the swap, not merely when the message
 * is queued — the purge of the previous account's entries happens while the
 * message is handled, so resolving earlier would report a swap that has not
 * taken effect yet.
 */
export async function announceCacheOwner(userId: string): Promise<void> {
  const container = getServiceWorkerContainer()
  if (!container) return

  // Before the first activation the page isn't controlled yet, so fall back to
  // the registration's active worker. Deliberately `getRegistration()` and not
  // `ready`: `ready` never settles when nothing is registered, which is every
  // page load in development and the first one in production — awaiting it
  // would hang the sign-in that calls this before navigating.
  const worker = container.controller ?? (await container.getRegistration())?.active
  if (!worker) return

  const channel = new MessageChannel()
  const acknowledged = new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve()
  })
  worker.postMessage({ type: 'SET_CACHE_OWNER', userId }, [channel.port2])

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      acknowledged,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, OWNER_ACK_TIMEOUT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
    channel.port1.close()
  }
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
