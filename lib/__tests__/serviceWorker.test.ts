// Exercises the real production service worker (public/sw.js) against a fake
// Cache Storage / fetch environment. The worker only registers in production
// (ServiceWorkerRegistration bails out otherwise), so no browser-level test
// covers it — but it is the layer that decides whether one account's cached
// portfolio data can be handed to the next account on a shared browser (#565).

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// ── Minimal fetch-API doubles ────────────────────────────────────────────────
// jsdom ships no Cache Storage and no Response, and the worker only needs a
// narrow slice of each, so hand-rolled doubles keep the harness hermetic.

class FakeHeaders {
  private map = new Map<string, string>()
  constructor(init?: FakeHeaders | Record<string, string>) {
    if (init instanceof FakeHeaders) init.map.forEach((v, k) => this.map.set(k, v))
    else if (init) Object.entries(init).forEach(([k, v]) => this.map.set(k.toLowerCase(), v))
  }
  get(key: string) { return this.map.get(key.toLowerCase()) ?? null }
  set(key: string, value: string) { this.map.set(key.toLowerCase(), value) }
}

class FakeResponse {
  status: number
  statusText: string
  headers: FakeHeaders
  constructor(public body: unknown, init: { status?: number; statusText?: string; headers?: FakeHeaders | Record<string, string> } = {}) {
    this.status = init.status ?? 200
    this.statusText = init.statusText ?? ''
    this.headers = init.headers instanceof FakeHeaders ? new FakeHeaders(init.headers) : new FakeHeaders(init.headers)
  }
  get ok() { return this.status >= 200 && this.status < 300 }
  clone() { return new FakeResponse(this.body, { status: this.status, statusText: this.statusText, headers: this.headers }) }
  async blob() { return this.body }
  async text() { return typeof this.body === 'string' ? this.body : JSON.stringify(this.body) }
  async json() { return typeof this.body === 'string' ? JSON.parse(this.body) : this.body }
}

type FakeRequest = { url: string; method: string; mode?: string; destination?: string }

const keyOf = (req: FakeRequest | string) => (typeof req === 'string' ? req : req.url)

class FakeCache {
  store = new Map<string, FakeResponse>()
  async put(req: FakeRequest | string, res: FakeResponse) { this.store.set(keyOf(req), res) }
  async add(url: string) { this.store.set(url, new FakeResponse(`offline-fallback:${url}`, { status: 200 })) }
  async match(req: FakeRequest | string) { return this.store.get(keyOf(req)) }
  async delete(req: FakeRequest | string) { return this.store.delete(keyOf(req)) }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name)!
  }
  async keys() { return [...this.caches.keys()] }
  async delete(name: string) { return this.caches.delete(name) }
  async has(name: string) { return this.caches.has(name) }
  async match(req: FakeRequest | string) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(req)
      if (hit) return hit
    }
    return undefined
  }
}

// ── Worker harness ───────────────────────────────────────────────────────────

const SW_SOURCE = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8')

type Listener = (event: Record<string, unknown>) => void

function loadWorker(networkHandler: (req: FakeRequest) => Promise<FakeResponse>) {
  const listeners = new Map<string, Listener[]>()
  const pending: Promise<unknown>[] = []
  const cacheStorage = new FakeCacheStorage()

  const self = {
    addEventListener: (type: string, fn: Listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }

  const fetchImpl = async (req: FakeRequest, init?: { signal?: AbortSignal }) => {
    if (init?.signal?.aborted) throw new Error('aborted')
    return networkHandler(req)
  }

  const factory = new Function(
    'self', 'caches', 'fetch', 'Response', 'Headers', 'URL', 'AbortController', 'setTimeout', 'clearTimeout',
    SW_SOURCE,
  )
  factory(self, cacheStorage, fetchImpl, FakeResponse, FakeHeaders, URL, AbortController, setTimeout, clearTimeout)

  const dispatch = async (type: string, event: Record<string, unknown>) => {
    for (const fn of listeners.get(type) ?? []) await fn(event)
    await Promise.all(pending.splice(0))
  }

  return {
    cacheStorage,
    /** Drive a GET through the worker's fetch handler; undefined = worker passed through. */
    async request(req: Partial<FakeRequest> & { url: string }) {
      const request: FakeRequest = { method: 'GET', ...req }
      let responded: Promise<FakeResponse> | undefined
      await dispatch('fetch', {
        request,
        respondWith: (p: Promise<FakeResponse>) => { responded = p },
        waitUntil: (p: Promise<unknown>) => { pending.push(p) },
      })
      const result = responded ? await responded : undefined
      await Promise.all(pending.splice(0))
      return result
    },
    async message(data: unknown) {
      await dispatch('message', { data, waitUntil: (p: Promise<unknown>) => { pending.push(p) } })
    },
    async install() {
      await dispatch('install', { waitUntil: (p: Promise<unknown>) => { pending.push(p) } })
    },
  }
}

const OVERVIEW_URL = 'https://cairn.app/api/v1/dashboard/overview'
const DASHBOARD_URL = 'https://cairn.app/dashboard'

/** Network that serves per-account payloads, and can be switched offline. */
function makeNetwork() {
  const state = { online: true, body: 'user-a-portfolio', page: '<html>user-a-dashboard</html>' }
  const handler = async (req: FakeRequest) => {
    if (!state.online) throw new Error('offline')
    const isPage = req.mode === 'navigate'
    return new FakeResponse(isPage ? state.page : state.body, { status: 200 })
  }
  return { state, handler }
}

describe('service worker — authenticated cache isolation', () => {
  let net: ReturnType<typeof makeNetwork>
  let sw: ReturnType<typeof loadWorker>

  beforeEach(() => {
    net = makeNetwork()
    sw = loadWorker(net.handler)
  })

  it('serves user A their own cached API response while offline', async () => {
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: OVERVIEW_URL })

    net.state.online = false
    const offline = await sw.request({ url: OVERVIEW_URL })

    expect(await offline!.text()).toBe('user-a-portfolio')
  })

  it('never returns user A cached API data after a logout and login as user B', async () => {
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: OVERVIEW_URL })
    expect(await (await sw.request({ url: OVERVIEW_URL }))!.text()).toBe('user-a-portfolio')

    // Sign out, then user B signs in on the same browser profile.
    await sw.message({ type: 'CLEAR_CACHE_OWNER' })
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-b' })

    // B goes offline before replacing the cached URL.
    net.state.online = false
    const offline = await sw.request({ url: OVERVIEW_URL })

    expect(offline!.status).toBe(503)
    expect(await offline!.text()).not.toContain('user-a')
  })

  it('never returns user A cached data when the session expires and user B signs in without an explicit logout', async () => {
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: OVERVIEW_URL })

    // Session expiry leaves no logout; the next account simply announces itself.
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-b' })

    net.state.online = false
    const offline = await sw.request({ url: OVERVIEW_URL })

    expect(offline!.status).toBe(503)
    expect(await offline!.text()).not.toContain('user-a')
  })

  it('does not serve user A cached page HTML to user B offline', async () => {
    await sw.install()
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: DASHBOARD_URL, mode: 'navigate' })

    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-b' })
    net.state.online = false
    const offline = await sw.request({ url: DASHBOARD_URL, mode: 'navigate' })

    expect(await offline!.text()).not.toContain('user-a-dashboard')
  })

  it('falls back to the offline page rather than a cached page when no account is known', async () => {
    await sw.install()
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: DASHBOARD_URL, mode: 'navigate' })
    await sw.message({ type: 'CLEAR_CACHE_OWNER' })

    net.state.online = false
    const offline = await sw.request({ url: DASHBOARD_URL, mode: 'navigate' })

    expect(await offline!.text()).not.toContain('user-a-dashboard')
  })

  it('does not cache authenticated responses fetched before any account is announced', async () => {
    await sw.request({ url: OVERVIEW_URL })
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-b' })

    net.state.online = false
    const offline = await sw.request({ url: OVERVIEW_URL })

    expect(offline!.status).toBe(503)
  })

  it('keeps the cache when the same account re-announces itself', async () => {
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: OVERVIEW_URL })
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })

    net.state.online = false
    const offline = await sw.request({ url: OVERVIEW_URL })

    expect(await offline!.text()).toBe('user-a-portfolio')
  })

  it('keeps static assets cached across accounts — they carry no user data', async () => {
    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-a' })
    await sw.request({ url: 'https://cairn.app/_next/static/chunk.js' })

    await sw.message({ type: 'SET_CACHE_OWNER', userId: 'user-b' })
    net.state.online = false
    const asset = await sw.request({ url: 'https://cairn.app/_next/static/chunk.js' })

    expect(asset!.status).toBe(200)
  })
})
