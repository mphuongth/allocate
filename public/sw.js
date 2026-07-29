// Bumped from v7 with the cache-owner rules below: the old `api-v1-v7` /
// `pages-v7` entries were written without any account attached, so they can't
// be trusted once ownership matters. The version bump makes `activate` drop
// them on first deploy.
const CACHE_VERSION = 'v8'
const STATIC_CACHE = `static-assets-${CACHE_VERSION}`
const OFFLINE_URL = '/~offline'

// ── Cache ownership ───────────────────────────────────────────────────────────
// API responses and page HTML are per-account, but they are keyed by URL alone —
// on a shared browser profile user B could be served user A's cached dashboard
// (#565). So authenticated responses are *partitioned*: each account gets its
// own pair of caches, named after an opaque token minted when that account takes
// ownership.
//
// Partitioning rather than a shared cache guarded by checks is what makes this
// timing-independent. A response is written to the partition of whoever asked
// for it, decided before the request goes out; reads only ever open the current
// owner's partition. An account switch landing midway through a request can
// therefore never misfile a response, however the awaits interleave — the worst
// case is a write into a partition nobody will read again, which the next sweep
// removes. With no owner recorded there is no partition at all, so the worker
// fails closed: nothing is read and nothing is stored.
//
// The record has to survive the worker being killed and restarted, and a worker
// has no localStorage, so it lives in its own Cache Storage entry. The token is
// used instead of the user id so cache names, which are visible in devtools,
// don't enumerate the accounts that have used this browser. STATIC_CACHE is
// deliberately shared: chunks, images and fonts carry no user data.
const OWNER_CACHE = `cache-owner-${CACHE_VERSION}`
// Same-origin-shaped key; never fetched, only used as a Cache Storage index.
const OWNER_KEY = '/__cache-owner__'
const API_CACHE_PREFIX = `api-v1-${CACHE_VERSION}-`
const PAGE_CACHE_PREFIX = `pages-${CACHE_VERSION}-`

/** @returns {Promise<{userId: string, token: string} | null>} */
async function readCacheOwner() {
  const cache = await caches.open(OWNER_CACHE)
  const record = await cache.match(OWNER_KEY)
  if (!record) return null
  try {
    const owner = JSON.parse(await record.text())
    return owner && owner.userId && owner.token ? owner : null
  } catch {
    return null
  }
}

const apiCacheFor = (owner) => (owner ? API_CACHE_PREFIX + owner.token : null)
const pageCacheFor = (owner) => (owner ? PAGE_CACHE_PREFIX + owner.token : null)

/** Delete every authenticated partition except the one `keep` owns (all, if null). */
async function sweepPartitions(keep) {
  const keys = await caches.keys()
  const mine = [apiCacheFor(keep), pageCacheFor(keep)]
  await Promise.all(
    keys
      .filter((key) => key.startsWith(API_CACHE_PREFIX) || key.startsWith(PAGE_CACHE_PREFIX))
      .filter((key) => !mine.includes(key))
      .map((key) => caches.delete(key))
  )
}

/**
 * Adopt `userId` as the cache owner. A different account gets a fresh partition
 * and the previous one is swept; the same account keeps its cache, so an
 * ordinary reload or token refresh costs nothing.
 */
async function setCacheOwner(userId) {
  const current = await readCacheOwner()
  if (current && current.userId === userId) {
    await sweepPartitions(current)
    return
  }

  const owner = userId ? { userId, token: mintToken() } : null
  const cache = await caches.open(OWNER_CACHE)
  // Record first: until this lands, reads still resolve to the old partition,
  // and after it they resolve to a partition that is empty by construction.
  if (owner) await cache.put(OWNER_KEY, new Response(JSON.stringify(owner)))
  else await cache.delete(OWNER_KEY)
  await sweepPartitions(owner)
}

/** Sign-out: drop every authenticated response and forget who they belonged to. */
async function clearCacheOwner() {
  // Forget first, so any request racing this one finds no owner and fails closed.
  const cache = await caches.open(OWNER_CACHE)
  await cache.delete(OWNER_KEY)
  await sweepPartitions(null)
}

function mintToken() {
  if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// ── Messages ──────────────────────────────────────────────────────────────────
// The page announces the signed-in account on load and on every auth-state
// change, and clears it on sign-out — see lib/clientCache.ts.
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data) return

  let work = null
  if (data.type === 'SET_CACHE_OWNER') work = setCacheOwner(data.userId ?? null)
  else if (data.type === 'CLEAR_CACHE_OWNER') work = clearCacheOwner()
  if (!work) return

  // Reply when asked, so the page can await the purge before routing to login.
  const port = event.ports && event.ports[0]
  const done = port ? work.then(() => port.postMessage({ ok: true })) : work
  if (event.waitUntil) event.waitUntil(done)
})

// ── Install ───────────────────────────────────────────────────────────────────
// Pre-cache the offline fallback page so it's always available.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.add(OFFLINE_URL))
  )
  self.skipWaiting()
})

// ── Activate ──────────────────────────────────────────────────────────────────
// Remove stale caches from previous versions, along with any partition that is
// not the current owner's — including the unpartitioned `api-v1-v7` / `pages-v7`
// entries, which were written before ownership existed and can't be attributed.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    readCacheOwner()
      .then((owner) => {
        const keep = [STATIC_CACHE, OWNER_CACHE, apiCacheFor(owner), pageCacheFor(owner)]
        return caches
          .keys()
          .then((keys) => Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key))))
      })
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET requests and chrome-extension / non-http(s) requests
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) return

  // API routes — NetworkFirst, 24 h cache. The timeout exists only to fall back
  // to cache when the network is dead; a real offline fetch rejects almost
  // immediately, so this window should be generous enough to never abort a
  // slow-but-alive response (e.g. a cold serverless start aggregating the
  // dashboard overview). 10 s was too tight and surfaced spurious "Offline"
  // errors on good connections.
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(networkFirst(event, request, apiCacheFor, 30_000))
    return
  }

  // Page navigation — NetworkFirst, keyed by URL string (avoids Vary mismatches),
  // falls back to cached page then offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(navigateHandler(event, request))
    return
  }

  // Next.js static chunks — immutable (content-hashed filenames), CacheFirst
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // Images and fonts — CacheFirst, served from cache after first load
  if (request.destination === 'image' || request.destination === 'font') {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
  }
})

// ── Handlers ──────────────────────────────────────────────────────────────────

async function navigateHandler(event, request) {
  // Resolved before the fetch goes out: this page belongs to whoever was signed
  // in when it was asked for, so that is the partition it may be written to,
  // whatever happens to the current owner in the meantime.
  const partition = pageCacheFor(await readCacheOwner())

  try {
    const response = await fetch(request)
    // Clone BEFORE returning the response — once the browser starts reading
    // the body the stream is disturbed and clone() silently produces an empty body.
    if (response.status === 200 && partition) {
      const clone = response.clone()
      event.waitUntil(caches.open(partition).then((cache) => cache.put(request.url, clone)))
    }
    return response
  } catch {
    // Network failed — serve the cached page by URL (no Vary check) from the
    // same partition the request was issued under, never from whichever account
    // happens to own the cache now. With no partition (signed out, or a fresh
    // worker) the offline fallback below is the safe answer, and a partition
    // swept by an account switch is empty, so this fails closed either way.
    const cached = partition ? await (await caches.open(partition)).match(request.url) : null
    if (cached) return cached

    // No cached page — show offline fallback
    const staticCache = await caches.open(STATIC_CACHE)
    const offline = await staticCache.match(OFFLINE_URL)
    return offline ?? new Response('Offline', { status: 503 })
  }
}

// ── Strategies ────────────────────────────────────────────────────────────────

/**
 * NetworkFirst: try network with a timeout, fall back to cache.
 * Cached responses expire after 24 h (checked on retrieval).
 *
 * `partitionFor` maps a cache owner to the cache this request may use, so the
 * response is filed under the account that asked for it — see navigateHandler.
 */
async function networkFirst(event, request, partitionFor, timeoutMs) {
  const partition = partitionFor(await readCacheOwner())
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.ok && partition) {
      const blob = await response.clone().blob()
      const headers = new Headers(response.headers)
      headers.set('sw-cached-at', Date.now().toString())
      const timestamped = new Response(blob, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
      // Extend SW lifetime so the cache write finishes before idle
      event.waitUntil(caches.open(partition).then((cache) => cache.put(request, timestamped)))
    }
    return response
  } catch {
    clearTimeout(timeoutId)
    // Same partition the request was issued under — see navigateHandler.
    const cached = partition ? await (await caches.open(partition)).match(request) : null
    if (cached) {
      const cachedAt = Number(cached.headers.get('sw-cached-at') ?? 0)
      const maxAge = 24 * 60 * 60 * 1000 // 24 h
      if (Date.now() - cachedAt < maxAge) return cached
    }
    return new Response(JSON.stringify({ error: 'Offline', cached: false }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/**
 * CacheFirst: serve from cache if available, otherwise fetch and cache.
 */
async function cacheFirst(request, cacheName) {
  // Scoped to the named cache rather than a global `caches.match`, which would
  // search the account partitions too and could answer a static request from
  // authenticated data.
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    return new Response('', { status: 503 })
  }
}
