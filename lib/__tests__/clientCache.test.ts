import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearAppCaches, announceCacheOwner, buildCacheOwnerScript } from '../clientCache'

const postMessage = vi.fn()

function stubCacheStorage(names: string[]) {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: async () => names,
    delete: async (name: string) => { deleted.push(name); return true },
  })
  return deleted
}

/**
 * @param acks whether the fake worker replies on the port it is handed, the way
 *   public/sw.js does once the purge has finished.
 */
function stubServiceWorker({ controlled, acks = true, registered = true }: { controlled: boolean; acks?: boolean; registered?: boolean }) {
  const worker = {
    postMessage: (...args: [unknown, Transferable[]?]) => {
      postMessage(...args)
      const port = args[1]?.[0] as MessagePort | undefined
      if (acks && port) port.postMessage({ ok: true })
    },
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: controlled ? worker : null,
      getRegistration: async () => (registered ? { active: worker } : undefined),
      // Present but never settling, as in a browser with nothing registered —
      // touching this must not hang the caller.
      ready: new Promise(() => {}),
    },
  })
}

describe('clearAppCaches', () => {
  beforeEach(() => {
    localStorage.clear()
    postMessage.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('removes only app cache keys and leaves unrelated keys intact', async () => {
    localStorage.setItem('dashboardOverviewCache', '1')
    localStorage.setItem('planningCache_2026-06', '1')
    localStorage.setItem('savingsGoalsCache', '1')
    localStorage.setItem('fixedExpensesCache:bills', '1')
    localStorage.setItem('insuranceMembersCache', '1')
    localStorage.setItem('fundLibraryCache', '1')
    localStorage.setItem('cairn.insuranceCoachDismissed', '1') // unrelated, must survive
    localStorage.setItem('theme', 'dark') // unrelated, must survive

    await clearAppCaches()

    expect(localStorage.getItem('dashboardOverviewCache')).toBeNull()
    expect(localStorage.getItem('planningCache_2026-06')).toBeNull()
    expect(localStorage.getItem('savingsGoalsCache')).toBeNull()
    expect(localStorage.getItem('fixedExpensesCache:bills')).toBeNull()
    expect(localStorage.getItem('insuranceMembersCache')).toBeNull()
    expect(localStorage.getItem('fundLibraryCache')).toBeNull()
    expect(localStorage.getItem('cairn.insuranceCoachDismissed')).toBe('1')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('deletes the authenticated service-worker caches and the owner record', async () => {
    const deleted = stubCacheStorage(['api-v1-v8', 'pages-v8', 'cache-owner-v8', 'static-assets-v8'])

    await clearAppCaches()

    expect(deleted).toContain('api-v1-v8')
    expect(deleted).toContain('pages-v8')
    expect(deleted).toContain('cache-owner-v8')
  })

  it('leaves static assets cached — they hold no user data', async () => {
    const deleted = stubCacheStorage(['api-v1-v8', 'static-assets-v8'])

    await clearAppCaches()

    expect(deleted).not.toContain('static-assets-v8')
  })

  it('tells the active worker to forget the owner', async () => {
    stubCacheStorage([])
    stubServiceWorker({ controlled: true })

    await clearAppCaches()

    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHE_OWNER' })
  })

  it('still clears localStorage where Cache Storage is unavailable', async () => {
    localStorage.setItem('savingsGoalsCache', '1')

    await expect(clearAppCaches()).resolves.toBeUndefined()

    expect(localStorage.getItem('savingsGoalsCache')).toBeNull()
  })
})

// React effects can't win this race: effects run child-first, so the dashboard's
// data fetch starts before the layout's announcement. An inline script in the
// authenticated layout runs during HTML parsing — before hydration, before any
// fetch, and on flows no client code precedes, such as the email-confirmation
// callback redirecting straight to /dashboard.
describe('buildCacheOwnerScript', () => {
  beforeEach(() => localStorage.clear())

  function run(script: string, controller: { postMessage: (v: unknown) => void } | null) {
    const nav = { serviceWorker: controller ? { controller } : undefined }
    new Function('navigator', 'localStorage', script)(nav, localStorage)
  }

  // Not every localStorage snapshot is user-keyed — `planningCache_${month}_${year}`
  // is not — so an account takeover that runs no sign-out handler (visiting
  // /auth/login directly, or the old session expiring while the app was closed)
  // would otherwise hand the new account the previous one's plan. This runs
  // during parse, before anything reads those keys.
  it('drops local snapshots when a different account takes over', () => {
    localStorage.setItem('planningCache_6_2026', '1')
    localStorage.setItem('savingsGoalsCache', '1')
    localStorage.setItem('theme', 'dark') // unrelated, must survive

    run(buildCacheOwnerScript('user-b'), null)

    expect(localStorage.getItem('planningCache_6_2026')).toBeNull()
    expect(localStorage.getItem('savingsGoalsCache')).toBeNull()
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('keeps local snapshots when the same account loads another page', () => {
    run(buildCacheOwnerScript('user-a'), null)
    localStorage.setItem('planningCache_6_2026', '1')

    run(buildCacheOwnerScript('user-a'), null)

    expect(localStorage.getItem('planningCache_6_2026')).toBe('1')
  })

  it('claims ownership through the controlling worker', () => {
    const sent: unknown[] = []
    run(buildCacheOwnerScript('user-a'), { postMessage: (v) => sent.push(v) })

    expect(sent).toEqual([{ type: 'SET_CACHE_OWNER', userId: 'user-a' }])
  })

  it('does nothing when the page is not controlled by a worker', () => {
    expect(() => run(buildCacheOwnerScript('user-a'), null)).not.toThrow()
  })

  it('cannot break out of the script element', () => {
    const script = buildCacheOwnerScript('</script><img onerror=alert(1)>')

    expect(script).not.toContain('</script>')
    expect(script).not.toContain('<')
  })

  it('embeds the id as data rather than interpolated source', () => {
    const sent: unknown[] = []
    run(buildCacheOwnerScript("'); alert(1); ('"), { postMessage: (v) => sent.push(v) })

    expect(sent).toEqual([{ type: 'SET_CACHE_OWNER', userId: "'); alert(1); ('" }])
  })
})

describe('announceCacheOwner', () => {
  beforeEach(() => { postMessage.mockClear(); localStorage.clear() })
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })

  it('announces the signed-in account to the controlling worker', async () => {
    stubServiceWorker({ controlled: true })

    await announceCacheOwner('user-a')

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SET_CACHE_OWNER', userId: 'user-a' },
      expect.any(Array),
    )
  })

  it('waits for the registration when the page is not yet controlled', async () => {
    stubServiceWorker({ controlled: false })

    await announceCacheOwner('user-b')

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'SET_CACHE_OWNER', userId: 'user-b' },
      expect.any(Array),
    )
  })

  // The worker purges the previous account's caches while handling the message,
  // so resolving on `postMessage` alone would let a caller believe the swap is
  // done while the old entries are still readable.
  it('resolves only once the worker acknowledges the swap', async () => {
    stubServiceWorker({ controlled: true })
    let settled = false

    const pending = announceCacheOwner('user-a').then(() => { settled = true })
    expect(settled).toBe(false)

    await pending
    expect(settled).toBe(true)
  })

  // A timeout is not a completed swap. Callers navigate to the dashboard as
  // soon as this resolves, so an unacknowledged change must leave nothing the
  // worker could serve rather than look like success.
  it('gives up waiting rather than hanging when the worker never replies', async () => {
    vi.useFakeTimers()
    stubServiceWorker({ controlled: true, acks: false })

    const pending = announceCacheOwner('user-a')
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  it('deletes the authenticated caches when the swap is never acknowledged', async () => {
    vi.useFakeTimers()
    const deleted = stubCacheStorage(['api-v1-v8-tok', 'pages-v8-tok', 'cache-owner-v8', 'static-assets-v8'])
    stubServiceWorker({ controlled: true, acks: false })

    const pending = announceCacheOwner('user-a')
    await vi.advanceTimersByTimeAsync(5_000)
    await pending

    expect(deleted).toContain('api-v1-v8-tok')
    expect(deleted).toContain('pages-v8-tok')
    expect(deleted).toContain('cache-owner-v8')
    expect(deleted).not.toContain('static-assets-v8')
    vi.useRealTimers()
  })

  it('leaves the caches alone when the swap is acknowledged', async () => {
    const deleted = stubCacheStorage(['api-v1-v8-tok', 'pages-v8-tok'])
    stubServiceWorker({ controlled: true })

    await announceCacheOwner('user-a')

    expect(deleted).toEqual([])
  })

  // Nothing is registered in development, and nothing is registered on the very
  // first production load either. `ready` never settles in that state, so the
  // sign-in that awaits this before navigating would hang forever.
  it('returns promptly when no worker is registered', async () => {
    stubServiceWorker({ controlled: false, registered: false })

    await expect(announceCacheOwner('user-a')).resolves.toBeUndefined()
    expect(postMessage).not.toHaveBeenCalled()
  })

  // No reload happens when another tab swaps the account, so the parse-time
  // script never runs and this is the only thing that notices.
  it('drops local snapshots when the account changes without a page load', async () => {
    localStorage.setItem('planningCache_6_2026', '1')

    await announceCacheOwner('user-b')

    expect(localStorage.getItem('planningCache_6_2026')).toBeNull()
  })

  it('keeps local snapshots when the same account re-announces', async () => {
    await announceCacheOwner('user-a')
    localStorage.setItem('planningCache_6_2026', '1')

    await announceCacheOwner('user-a')

    expect(localStorage.getItem('planningCache_6_2026')).toBe('1')
  })

  it('is a no-op without service-worker support', async () => {
    await expect(announceCacheOwner('user-a')).resolves.toBeUndefined()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
