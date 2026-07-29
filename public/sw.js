// Bumped from v7 with the cache-owner rules below: the old `api-v1-v7` /
// `pages-v7` entries were written without any account attached, so they can't
// be trusted once ownership matters. The version bump makes `activate` drop
// them on first deploy.
const CACHE_VERSION = 'v8'
const API_CACHE = `api-v1-${CACHE_VERSION}`
const STATIC_CACHE = `static-assets-${CACHE_VERSION}`
const PAGE_CACHE = `pages-${CACHE_VERSION}`
const OFFLINE_URL = '/~offline'

// ── Cache ownership ───────────────────────────────────────────────────────────
// API responses and page HTML are per-account, but the caches above are keyed by
// URL alone — on a shared browser profile user B could be served user A's cached
// dashboard (#565). So the worker tracks which account the authenticated caches
// belong to, and:
//
//   • only ever reads or writes them while an owner is known (fail closed), and
//   • wipes them whenever the owner changes or is cleared.
//
// The record has to survive the worker being killed and restarted, and a worker
// has no localStorage, so it lives in its own Cache Storage entry. STATIC_CACHE
// is deliberately left alone: chunks, images and fonts carry no user data.
const OWNER_CACHE = `cache-owner-${CACHE_VERSION}`
// Same-origin-shaped key; never fetched, only used as a Cache Storage index.
const OWNER_KEY = '/__cache-owner__'

async function readCacheOwner() {
  const cache = await caches.open(OWNER_CACHE)
  const record = await cache.match(OWNER_KEY)
  if (!record) return null
  const owner = await record.text()
  return owner || null
}

async function purgeUserCaches() {
  await Promise.all([caches.delete(API_CACHE), caches.delete(PAGE_CACHE)])
}

/** Adopt `userId` as the cache owner, wiping the caches if it isn't the current one. */
async function setCacheOwner(userId) {
  if ((await readCacheOwner()) !== userId) await purgeUserCaches()
  const cache = await caches.open(OWNER_CACHE)
  if (userId) await cache.put(OWNER_KEY, new Response(userId))
  else await cache.delete(OWNER_KEY)
}

/** Sign-out: drop every authenticated response and forget who they belonged to. */
async function clearCacheOwner() {
  await purgeUserCaches()
  const cache = await caches.open(OWNER_CACHE)
  await cache.delete(OWNER_KEY)
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
// Remove stale caches from previous versions.
self.addEventListener('activate', (event) => {
  const currentCaches = [API_CACHE, STATIC_CACHE, PAGE_CACHE, OWNER_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !currentCaches.includes(key))
            .map((key) => caches.delete(key))
        )
      )
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
    event.respondWith(networkFirst(event, request, API_CACHE, 30_000))
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
  try {
    const response = await fetch(request)
    // Clone BEFORE returning the response — once the browser starts reading
    // the body the stream is disturbed and clone() silently produces an empty body.
    if (response.status === 200) {
      const clone = response.clone()
      event.waitUntil(
        readCacheOwner().then((owner) => {
          // Unattributable page: don't store it rather than risk serving it to
          // whoever signs in next.
          if (!owner) return
          return caches.open(PAGE_CACHE).then((cache) => cache.put(request.url, clone))
        })
      )
    }
    return response
  } catch {
    // Network failed — serve cached page by URL (no Vary check), but only while
    // an account owns the cache. With no owner (signed out, or a fresh worker)
    // the offline fallback below is the safe answer.
    const owner = await readCacheOwner()
    const pageCache = owner ? await caches.open(PAGE_CACHE) : null
    const cached = pageCache ? await pageCache.match(request.url) : null
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
 */
async function networkFirst(event, request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)

    // Only cache what can be attributed to the signed-in account, so a response
    // fetched before the page announced itself can never outlive that session.
    if (response.ok && (await readCacheOwner())) {
      const blob = await response.clone().blob()
      const headers = new Headers(response.headers)
      headers.set('sw-cached-at', Date.now().toString())
      const timestamped = new Response(blob, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
      // Extend SW lifetime so the cache write finishes before idle
      event.waitUntil(cache.put(request, timestamped))
    }
    return response
  } catch {
    clearTimeout(timeoutId)
    const cached = (await readCacheOwner()) ? await cache.match(request) : null
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
  const cached = await caches.match(request)
  if (cached) return cached

  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    return new Response('', { status: 503 })
  }
}
