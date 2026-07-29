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
  function run(script: string, controller: { postMessage: (v: unknown) => void } | null) {
    const nav = { serviceWorker: controller ? { controller } : undefined }
    new Function('navigator', script)(nav)
  }

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
  beforeEach(() => postMessage.mockClear())
  afterEach(() => Reflect.deleteProperty(navigator, 'serviceWorker'))

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

  it('gives up waiting rather than hanging when the worker never replies', async () => {
    vi.useFakeTimers()
    stubServiceWorker({ controlled: true, acks: false })

    const pending = announceCacheOwner('user-a')
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  // Nothing is registered in development, and nothing is registered on the very
  // first production load either. `ready` never settles in that state, so the
  // sign-in that awaits this before navigating would hang forever.
  it('returns promptly when no worker is registered', async () => {
    stubServiceWorker({ controlled: false, registered: false })

    await expect(announceCacheOwner('user-a')).resolves.toBeUndefined()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('is a no-op without service-worker support', async () => {
    await expect(announceCacheOwner('user-a')).resolves.toBeUndefined()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
