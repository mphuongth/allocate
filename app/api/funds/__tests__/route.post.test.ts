import { describe, it, expect, vi, beforeEach } from 'vitest'

// Creating a fund that prices itself should not require the user to go and look
// the price up. When automatic pricing is on, the price the form would have
// asked for is the same number the route is about to fetch anyway — so the
// caller may leave it out and the route resolves it before the insert.

const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  user: { id: 'user-1' } as { id: string } | null,
  insertResult: { data: { id: 'f1' }, error: null } as { data: unknown; error: unknown },
  priceable: true as boolean | null,
  etfPriceable: true as boolean | null,
  navByCode: {} as Record<string, number>,
  etfPrices: {} as Record<string, number | null>,
  navError: null as Error | null,
}))

vi.mock('@/lib/fmarket-nav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/fmarket-nav')>()),
  isFundCodePriceable: async () => h.priceable,
  fetchFmarketNavIndex: async () => {
    if (h.navError) throw h.navError
    return new Map(Object.entries(h.navByCode))
  },
}))

vi.mock('@/lib/hose-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hose-price')>()
  return {
    ...actual,
    isEtfSymbolPriceable: async () => h.etfPriceable,
    fetchEtfMarketPrice: async (symbol: unknown) => h.etfPrices[actual.normalizeSymbol(symbol)] ?? null,
  }
})

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    insert: (payload: Record<string, unknown>) => { h.captured = payload; return chain },
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: async () => h.insertResult,
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
    }),
  }
})

import { POST } from '../route'

const makeReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/funds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]

beforeEach(() => {
  h.captured = null
  h.user = { id: 'user-1' }
  h.insertResult = { data: { id: 'f1' }, error: null }
  h.priceable = true
  h.etfPriceable = true
  h.navByCode = { DCDS: 93_915.08 }
  h.etfPrices = { FUEVFVND: 34_380 }
  h.navError = null
})

describe('POST /api/funds — the price the source already knows', () => {
  it('fetches an ETF’s market price when the form left it blank', async () => {
    const res = await POST(makeReq({
      name: 'DCVFM VN DIAMOND', code: 'FUEVFVND', fund_type: 'etf', nav_auto_sync: true,
    }))

    expect(res.status).toBe(201)
    expect(h.captured?.nav).toBe(34_380)
  })

  it('fetches an open-ended fund’s NAV the same way', async () => {
    await POST(makeReq({ name: 'DC Stock', code: 'DCDS', fund_type: 'equity', nav_auto_sync: true }))
    expect(h.captured?.nav).toBe(93_915.08)
  })

  it('keeps a price the user did type', async () => {
    // Someone entering their own number is not asking to be corrected — the
    // fetch is a fallback for a blank field, not an override.
    await POST(makeReq({
      name: 'DCVFM VN DIAMOND', code: 'FUEVFVND', fund_type: 'etf', nav: 30_000, nav_auto_sync: true,
    }))
    expect(h.captured?.nav).toBe(30_000)
  })

  it('asks for the price when the source cannot be reached', async () => {
    // Failing closed on the price, having failed open on the code: an
    // unverifiable ticker is no reason to block a save, but a fund inserted
    // without a price has nothing to show, and the DB would refuse it anyway.
    h.navError = new Error('Upstream responded 503 for api.fmarket.vn')
    const res = await POST(makeReq({ name: 'DC Stock', code: 'DCDS', fund_type: 'equity', nav_auto_sync: true }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/price/i)
    expect(h.captured).toBeNull()
  })

  it('still refuses a fund with no price and nothing to fetch one', async () => {
    const res = await POST(makeReq({ name: 'By hand', code: 'MANUAL', fund_type: 'equity', nav_auto_sync: false }))

    expect(res.status).toBe(400)
    expect(h.captured).toBeNull()
  })
})
