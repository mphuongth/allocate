import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The nightly refresh now draws on two price sources. What this file pins is the
// part that only exists at the route: it reads `fund_type` so the split can
// happen at all, and it counts per fund rather than per run — a source being
// unreachable used to fail EVERY fund, which with two sources would have let
// Fmarket's bad night freeze prices the exchange was answering for perfectly.

const h = vi.hoisted(() => ({
  selected: [] as string[],
  updates: [] as { nav: number; ids: string[] }[],
  funds: [] as unknown[],
  navError: null as Error | null,
  etfPrices: {} as Record<string, number | null>,
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      let op = 'select'
      let nav = 0
      const chain: Record<string, unknown> = {
        select: (cols: string) => { h.selected.push(cols); return chain },
        update: (patch: { nav: number }) => { op = 'update'; nav = patch.nav; return chain },
        eq: () => chain,
        in: (_col: string, ids: string[]) => { h.updates.push({ nav, ids }); return chain },
        then: (resolve: (v: unknown) => void) =>
          resolve(op === 'update' ? { error: null } : { data: h.funds, error: null }),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/fmarket-nav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/fmarket-nav')>()),
  fetchFmarketNavIndex: async () => {
    if (h.navError) throw h.navError
    return new Map([['DCDS', 93_915.08]])
  },
}))

vi.mock('@/lib/hose-price', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hose-price')>()
  return {
    ...actual,
    fetchEtfMarketPrice: async (symbol: unknown) =>
      h.etfPrices[actual.normalizeSymbol(symbol)] ?? null,
  }
})

const ORIGINAL_ENV = process.env
const CRON_SECRET = 'cron-secret'

const call = async () => {
  const { GET } = await import('../route')
  const res = await GET(new Request('https://app.test/api/cron/refresh-navs', {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  }))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.resetModules()
  process.env = {
    ...ORIGINAL_ENV,
    CRON_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  }
  h.selected = []
  h.updates = []
  h.navError = null
  h.etfPrices = { FUEVFVND: 34_380 }
  h.funds = [
    { id: 'fund-1', code: 'DCDS', fund_type: 'equity' },
    { id: 'etf-1', code: 'FUEVFVND', fund_type: 'etf' },
  ]
})

afterEach(() => { process.env = ORIGINAL_ENV; vi.restoreAllMocks() })

describe('GET /api/cron/refresh-navs — two sources', () => {
  it('reads the column that decides which source prices a fund', async () => {
    await call()
    expect(h.selected.join(' ')).toContain('fund_type')
  })

  it('prices each fund from its own source', async () => {
    const { body } = await call()

    expect(body).toEqual({ updated: 2, failed: 0 })
    expect(h.updates).toContainEqual({ nav: 93_915.08, ids: ['fund-1'] })
    expect(h.updates).toContainEqual({ nav: 34_380, ids: ['etf-1'] })
  })

  it('keeps pricing ETFs while the fund feed is down', async () => {
    h.navError = new Error('Fmarket: response was not JSON')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { body } = await call()

    expect(body).toEqual({ updated: 1, failed: 1 })
    expect(h.updates).toEqual([{ nav: 34_380, ids: ['etf-1'] }])
  })

  it('keeps pricing funds while a ticker cannot be resolved', async () => {
    h.etfPrices = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { body } = await call()

    expect(body).toEqual({ updated: 1, failed: 1 })
    expect(h.updates).toEqual([{ nav: 93_915.08, ids: ['fund-1'] }])
  })

  it('writes nothing when no fund opted in', async () => {
    h.funds = []
    expect((await call()).body).toEqual({ updated: 0, failed: 0 })
    expect(h.updates).toEqual([])
  })
})
