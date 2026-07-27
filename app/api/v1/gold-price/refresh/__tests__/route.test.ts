import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The refresh used to read the current price, then upsert the new one in a
// second statement, carrying the value it had just read into
// previous_price_per_chi (#528).
//
// The read's error was discarded, so a transient failure wrote previous = null —
// the comparison point erased while the endpoint still returned 200. The read
// also used .single(), which reports a genuinely absent row as an error, so a
// user's first refresh and a database failure looked identical. And a concurrent
// refresh landing in the gap produced a mismatched previous/current pair.
//
// refresh_gold_price does the whole thing in one INSERT … ON CONFLICT DO UPDATE.
// The carry-over semantics are pinned by supabase/tests/gold_refresh_atomic.test.sql
// against a real database; what matters here is that the route delegates to it —
// and, above all, that it performs no separate read that could reintroduce the gap.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  scrapeError: null as Error | null,
  price: 8_600_000,
  rpcResult: { data: null as unknown, error: null as unknown },
  rateLimit: { data: [{ allowed: true, retry_after_seconds: 0 }] as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: unknown }[],
  tableReads: [] as string[],
  scrapeCalls: 0,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    // Any table access at all is a regression: the atomic path must not need one.
    from: (table: string) => {
      h.tableReads.push(table)
      const c: Record<string, unknown> = {
        select: () => c,
        eq: () => c,
        upsert: () => c,
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
      }
      return c
    },
    // Two RPCs are involved: the rate-limit check is awaited directly, the
    // refresh goes through .single(). One object serves both shapes.
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args })
      return {
        single: async () => h.rpcResult,
        then: (resolve: (v: unknown) => void) => resolve(h.rateLimit),
      }
    },
  }),
}))

vi.mock('@/lib/scrape-gold', () => ({
  scrapeGoldPrice: async () => {
    h.scrapeCalls++
    if (h.scrapeError) throw h.scrapeError
    return h.price
  },
}))

const { POST } = await import('../route')

const FIRST_REFRESH = { price_per_chi: 8_600_000, previous_price_per_chi: null, updated_at: '2026-07-27T00:00:00.000Z' }
const LATER_REFRESH = { price_per_chi: 8_600_000, previous_price_per_chi: 8_500_000, updated_at: '2026-07-27T00:00:00.000Z' }

describe('POST /api/v1/gold-price/refresh', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.scrapeError = null
    h.price = 8_600_000
    h.rpcResult = { data: LATER_REFRESH, error: null }
    h.rateLimit = { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
    h.rpcCalls = []
    h.tableReads = []
    h.scrapeCalls = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    const res = await POST()
    expect(res.status).toBe(401)
    expect(h.rpcCalls).toEqual([])
  })

  it('returns 502 when the upstream scrape fails, without writing', async () => {
    h.scrapeError = new Error('Doji: NHẪN TRÒN price row not found')
    const res = await POST()
    expect(res.status).toBe(502)
    // The rate-limit check runs first and legitimately spends a slot — a failed
    // scrape still consumed an upstream request. What must not happen is a write.
    expect(h.rpcCalls.map((c) => c.name)).toEqual(['check_gold_refresh_rate_limit'])
  })

  // The structural guarantee: no read-then-write gap can exist if there is no read.
  it('performs no separate read before writing', async () => {
    await POST()
    expect(h.tableReads).toEqual([])
  })

  it('delegates the whole refresh to the atomic RPC', async () => {
    await POST()
    expect(h.rpcCalls).toContainEqual({ name: 'refresh_gold_price', args: { p_price: 8_600_000 } })
  })

  // ── per-user rate limit (#530) ───────────────────────────────────────────────
  it('checks the rate limit before scraping', async () => {
    await POST()
    expect(h.rpcCalls[0].name).toBe('check_gold_refresh_rate_limit')
  })

  it('returns 429 with Retry-After when the limit is exceeded', async () => {
    h.rateLimit = { data: [{ allowed: false, retry_after_seconds: 42 }], error: null }
    const res = await POST()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
  })

  // The whole point of the limit is sparing the upstream site — a refused call
  // that still scrapes would protect nothing.
  it('does not scrape or write when the limit is exceeded', async () => {
    h.rateLimit = { data: [{ allowed: false, retry_after_seconds: 42 }], error: null }
    await POST()
    expect(h.scrapeCalls).toBe(0)
    expect(h.rpcCalls.map((c) => c.name)).toEqual(['check_gold_refresh_rate_limit'])
  })

  // Fail CLOSED: if the limit can't be verified, refusing is safer than letting
  // the scrape run uncapped exactly when the database is unhealthy. Refresh is
  // non-essential, so a retryable 503 is the right default.
  it('returns 503 with Retry-After when the limit cannot be verified', async () => {
    h.rateLimit = { data: null, error: { message: 'timeout' } }
    const res = await POST()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(h.scrapeCalls).toBe(0)
  })

  it('fails closed when the limiter returns no verdict at all', async () => {
    h.rateLimit = { data: [], error: null }
    const res = await POST()
    expect(res.status).toBe(503)
    expect(h.scrapeCalls).toBe(0)
  })

  it('accepts a non-array verdict shape', async () => {
    h.rateLimit = { data: { allowed: true, retry_after_seconds: 0 }, error: null }
    expect((await POST()).status).toBe(200)
  })

  it('returns the stored pair for an existing settings row', async () => {
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(LATER_REFRESH)
  })

  it('returns a null previous price on a first refresh', async () => {
    h.rpcResult = { data: FIRST_REFRESH, error: null }
    const res = await POST()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(FIRST_REFRESH)
  })

  it('fails closed with 500 when the RPC errors', async () => {
    h.rpcResult = { data: null, error: { message: 'deadlock detected' } }
    expect((await POST()).status).toBe(500)
  })

  it('fails closed with 500 when the RPC returns no row', async () => {
    h.rpcResult = { data: null, error: null }
    expect((await POST()).status).toBe(500)
  })

  it('does not leak the database message to the client', async () => {
    h.rpcResult = { data: null, error: { message: 'relation "gold_price_settings" does not exist' } }
    const res = await POST()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
