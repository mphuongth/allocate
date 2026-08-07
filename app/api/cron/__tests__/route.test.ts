import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Both cron routes used to build their service-role Supabase client at module
// scope. Next evaluates every route module while collecting page data, so
// `npm run build` failed with `supabaseKey is required.` on any machine without
// the production secret — a build-time dependency on a runtime capability
// (#536).
//
// These tests pin the three properties the fix needs. The first one is the real
// regression test: importing the route module must not touch the secret at all.
// The rest keep the route failing closed once the client is built lazily.

const h = vi.hoisted(() => ({
  clients: [] as { url: string; key: string }[],
  results: {} as Record<string, { data: unknown; error: unknown }>,
  goldCalls: 0,
  navCalls: 0,
}))

vi.mock('@supabase/supabase-js', () => ({
  // Mirrors the real library: supabase-js throws on a falsy key, which is
  // exactly the `supabaseKey is required.` that broke the build. Without this
  // the "imports without the secret" test would pass vacuously.
  createClient: (url: string, key: string) => {
    if (!url) throw new Error('supabaseUrl is required.')
    if (!key) throw new Error('supabaseKey is required.')
    h.clients.push({ url, key })
    return {
      rpc: (name: string) =>
        Promise.resolve(h.results[`rpc:${name}`] ?? { data: null, error: null }),
      // Minimal PostgREST chain. `funds` is both read and written by the NAV
      // cron, so results are keyed by table *and* operation.
      from: (table: string) => {
        let op = 'select'
        const chain: Record<string, unknown> = {
          select: () => chain,
          update: () => { op = 'update'; return chain },
          not: () => chain,
          in: () => chain,
          then: (resolve: (v: unknown) => void) =>
            resolve(h.results[`${table}:${op}`] ?? { data: [], error: null }),
        }
        return chain
      },
    }
  },
}))

vi.mock('@/lib/scrape-gold', () => ({
  scrapeGoldPrice: async () => { h.goldCalls++; return 8_500_000 },
}))

vi.mock('@/lib/fmarket-nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fmarket-nav')>()
  return {
    ...actual,
    fetchFmarketNavIndex: async () => { h.navCalls++; return new Map([['DCDS', 12_345]]) },
  }
})

const ORIGINAL_ENV = process.env
const CRON_SECRET = 'cron-secret'

const ROUTES = [
  {
    name: 'refresh-gold',
    load: () => import('../refresh-gold/route'),
    seedSuccess: () => {
      h.results['rpc:refresh_gold_price_all'] = { data: 1, error: null }
    },
    scraperCalls: () => h.goldCalls,
  },
  {
    name: 'refresh-navs',
    load: () => import('../refresh-navs/route'),
    seedSuccess: () => {
      h.results['funds:select'] = {
        data: [{ id: 'fund-1', code: 'DCDS', nav_source_url: 'https://www.vcbf.com/fund' }],
        error: null,
      }
      h.results['funds:update'] = { data: null, error: null }
    },
    scraperCalls: () => h.navCalls,
  },
]

describe.each(ROUTES)('GET /api/cron/$name', (route) => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.clients.length = 0
    h.results = {}
    h.goldCalls = 0
    h.navCalls = 0
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      CRON_SECRET,
    }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    vi.restoreAllMocks()
  })

  const authorized = () =>
    new Request(`https://app.test/api/cron/${route.name}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })

  it('imports without SUPABASE_SERVICE_ROLE_KEY set', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    await expect(route.load()).resolves.toHaveProperty('GET')
  })

  it('creates no service-role client at import time', async () => {
    await route.load()
    expect(h.clients).toEqual([])
  })

  it('rejects an unauthorized request without creating a client', async () => {
    const { GET } = await route.load()
    const res = await GET(
      new Request(`https://app.test/api/cron/${route.name}`, {
        headers: { Authorization: 'Bearer wrong-secret' },
      }),
    )
    expect(res.status).toBe(401)
    expect(h.clients).toEqual([])
    expect(route.scraperCalls()).toBe(0)
  })

  it('fails closed with 500 when the service-role key is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { GET } = await route.load()
    const res = await GET(authorized())
    expect(res.status).toBe(500)
    expect(h.clients).toEqual([])
    // Missing config is terminal — don't hit the upstream site first.
    expect(route.scraperCalls()).toBe(0)
  })

  it('fails closed with 500 when the Supabase URL is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const { GET } = await route.load()
    const res = await GET(authorized())
    expect(res.status).toBe(500)
    expect(h.clients).toEqual([])
  })

  it('builds the client from the runtime env once the request is authorized', async () => {
    route.seedSuccess()
    const { GET } = await route.load()
    const res = await GET(authorized())
    expect(res.status).toBe(200)
    expect(h.clients).toEqual([{ url: 'https://test.supabase.co', key: 'service-role-key' }])
    expect(route.scraperCalls()).toBe(1)
  })
})
