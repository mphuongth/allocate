const CACHE_VERSION = 'v2'
const API_CACHE = `api-v1-${CACHE_VERSION}`
const STATIC_CACHE = `static-assets-${CACHE_VERSION}`
const OFFLINE_URL = '/~offline'

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
  const currentCaches = [API_CACHE, STATIC_CACHE]
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

  // API routes — NetworkFirst, 24 h cache, 10 s timeout
  if (url.pathname.startsWith('/api/v1/')) {
    event.respondWith(networkFirst(request, API_CACHE, 10_000))
    return
  }

  // Page navigation — NetworkFirst, cache on success, fallback to cached page or offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          if (cached) return cached
          const offline = await caches.match(OFFLINE_URL)
          return offline ?? new Response('Offline', { status: 503 })
        })
    )
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

// ── Strategies ────────────────────────────────────────────────────────────────

/**
 * NetworkFirst: try network with a timeout, fall back to cache.
 * Cached responses expire after 24 h (checked on retrieval).
 */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.ok) {
      const toCache = response.clone()
      // Attach a timestamp header for TTL checks
      const headers = new Headers(toCache.headers)
      headers.set('sw-cached-at', Date.now().toString())
      const timestamped = new Response(await toCache.blob(), {
        status: toCache.status,
        statusText: toCache.statusText,
        headers,
      })
      cache.put(request, timestamped)
    }
    return response
  } catch {
    clearTimeout(timeoutId)
    const cached = await cache.match(request)
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
