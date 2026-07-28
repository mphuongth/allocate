import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: unknown }>,
  result: { data: 2 as unknown, error: null as { message: string } | null },
  scrapeCalls: 0,
}))

vi.mock('@/lib/supabase-admin', () => ({
  createSupabaseAdminClient: () => ({
    // Deliberately expose no `from`: the regression is structural. If the route
    // returns to a direct table update, these tests fail before it can silently
    // stop carrying the previous price again.
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args })
      return h.result
    },
  }),
}))

vi.mock('@/lib/scrape-gold', () => ({
  scrapeGoldPrice: async () => {
    h.scrapeCalls++
    return 8_700_000
  },
}))

vi.mock('@/lib/cron-auth', () => ({
  verifyCronAuth: () => true,
}))

const { GET } = await import('../route')

describe('GET /api/cron/refresh-gold — atomic carry-over (#547)', () => {
  beforeEach(() => {
    h.rpcCalls = []
    h.result = { data: 2, error: null }
    h.scrapeCalls = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('delegates the bulk update to the atomic RPC with the scraped price', async () => {
    const res = await GET(new Request('https://app.test/api/cron/refresh-gold'))

    expect(res.status).toBe(200)
    expect(h.scrapeCalls).toBe(1)
    expect(h.rpcCalls).toEqual([
      { name: 'refresh_gold_price_all', args: { p_price: 8_700_000 } },
    ])
    await expect(res.json()).resolves.toEqual({ updated: 2, price: 8_700_000 })
  })

  it('fails closed when the atomic update errors', async () => {
    h.result = { data: null, error: { message: 'database unavailable' } }

    const res = await GET(new Request('https://app.test/api/cron/refresh-gold'))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update gold price' })
  })

  it('fails closed when the RPC returns no updated-row count', async () => {
    h.result = { data: null, error: null }

    const res = await GET(new Request('https://app.test/api/cron/refresh-gold'))

    expect(res.status).toBe(500)
  })
})
