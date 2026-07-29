import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { clearAppCaches, announceCacheOwner } from '../clientCache'

const postMessage = vi.fn()

function stubCacheStorage(names: string[]) {
  const deleted: string[] = []
  vi.stubGlobal('caches', {
    keys: async () => names,
    delete: async (name: string) => { deleted.push(name); return true },
  })
  return deleted
}

function stubServiceWorker({ controlled }: { controlled: boolean }) {
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: controlled ? { postMessage } : null,
      ready: Promise.resolve({ active: { postMessage } }),
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

describe('announceCacheOwner', () => {
  beforeEach(() => postMessage.mockClear())
  afterEach(() => Reflect.deleteProperty(navigator, 'serviceWorker'))

  it('announces the signed-in account to the controlling worker', async () => {
    stubServiceWorker({ controlled: true })

    await announceCacheOwner('user-a')

    expect(postMessage).toHaveBeenCalledWith({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
  })

  it('waits for the registration when the page is not yet controlled', async () => {
    stubServiceWorker({ controlled: false })

    await announceCacheOwner('user-b')

    expect(postMessage).toHaveBeenCalledWith({ type: 'SET_CACHE_OWNER', userId: 'user-b' })
  })

  it('is a no-op without service-worker support', async () => {
    await expect(announceCacheOwner('user-a')).resolves.toBeUndefined()
    expect(postMessage).not.toHaveBeenCalled()
  })
})
