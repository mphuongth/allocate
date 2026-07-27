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
  rpcCalls: [] as { name: string; args: unknown }[],
  tableReads: [] as string[],
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
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args })
      return { single: async () => h.rpcResult }
    },
  }),
}))

vi.mock('@/lib/scrape-gold', () => ({
  scrapeGoldPrice: async () => {
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
    h.rpcCalls = []
    h.tableReads = []
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
    expect(h.rpcCalls).toEqual([])
  })

  // The structural guarantee: no read-then-write gap can exist if there is no read.
  it('performs no separate read before writing', async () => {
    await POST()
    expect(h.tableReads).toEqual([])
  })

  it('delegates the whole refresh to the atomic RPC', async () => {
    await POST()
    expect(h.rpcCalls).toEqual([{ name: 'refresh_gold_price', args: { p_price: 8_600_000 } }])
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
