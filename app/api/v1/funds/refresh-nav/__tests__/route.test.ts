import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/v1/funds/refresh-nav must not let one authenticated user fan out
// unbounded outbound work (#515): it rate-limits per user (429) and reports
// per-fund results without failing the whole request when one fund can't price.
//
// The fan-out that #515 bounded is now structurally gone: NAVs come from a
// single upstream request covering every fund, so `upstreamCalls` staying at
// most 1 is the stronger form of the old de-duplication guarantee.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  funds: [] as { id: string; name: string; code: string }[],
  fundsError: null as unknown,
  rate: { allowed: true, retry_after_seconds: 0 } as { allowed: boolean; retry_after_seconds: number },
  rateError: null as unknown,
  navByCode: {} as Record<string, number>,
  upstreamError: null as Error | null,
  upstreamCalls: 0,
  updateError: null as unknown,
}))

// The upstream feed is mocked so the route test controls which codes resolve and
// can count how many times the feed is hit.
vi.mock('@/lib/fmarket-nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/fmarket-nav')>()
  return {
    ...actual,
    fetchFmarketNavIndex: vi.fn(async () => {
      h.upstreamCalls += 1
      if (h.upstreamError) throw h.upstreamError
      return new Map(Object.entries(h.navByCode))
    }),
  }
})

vi.mock('@/lib/supabase-server', () => {
  function chainFor(name: string) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      not: () => chain,
      in: () => chain,
      // funds SELECT is awaited directly
      then: (resolve: (v: unknown) => void) => resolve({ data: h.funds, error: h.fundsError }),
      // funds UPDATE().in('id', ids).eq().select() — captures the id filter and
      // awaits to only the matched rows (or an error), like the real .in().
      update: (patch: { nav: number }) => {
        let ids: string[] = []
        const upd: Record<string, unknown> = {
          in: (_col: string, vals: string[]) => { ids = vals; return upd },
          eq: () => upd,
          select: () => upd,
          then: (r: (v: unknown) => void) => r(updateResult(ids, patch.nav)),
        }
        return upd
      },
    }
    void name
    return chain
  }
  const updateResult = (ids: string[], nav: number) => {
    if (h.updateError) return { data: null, error: h.updateError }
    // echo back only the rows matched by .in('id', ids), like the real update
    const rows = h.funds.filter((f) => ids.includes(f.id))
    return { data: rows.map((f) => ({ id: f.id, name: f.name, code: f.code, nav, updated_at: 'now' })), error: null }
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (name: string) => chainFor(name),
      rpc: async () => ({ data: [h.rate], error: h.rateError }),
    }),
  }
})

import { POST } from '../route'

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.funds = []
  h.fundsError = null
  h.rate = { allowed: true, retry_after_seconds: 0 }
  h.rateError = null
  h.navByCode = {}
  h.upstreamError = null
  h.upstreamCalls = 0
  h.updateError = null
})

describe('POST /api/v1/funds/refresh-nav — rate limit (#515)', () => {
  it('returns 429 with Retry-After and does no upstream work when over the limit', async () => {
    h.rate = { allowed: false, retry_after_seconds: 42 }
    const res = await POST()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(h.upstreamCalls).toBe(0)
  })

  it('fails CLOSED (503 + Retry-After, no fetch) when the rate-limit RPC errors', async () => {
    // e.g. the RPC not migrated yet, or a transient DB error. We must not let the
    // refresh run uncapped when we can't verify the limit.
    h.rateError = { message: 'function does not exist' }
    h.funds = [{ id: 'a', name: 'A', code: 'A' }]
    h.navByCode = { A: 10 }
    const res = await POST()
    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    expect(h.upstreamCalls).toBe(0)
  })

  it('fails CLOSED (503) when the RPC returns no verdict row', async () => {
    h.rate = undefined as unknown as { allowed: boolean; retry_after_seconds: number }
    const res = await POST()
    expect(res.status).toBe(503)
    expect(h.upstreamCalls).toBe(0)
  })

  it('returns 401 when unauthenticated (before any rate-limit/upstream work)', async () => {
    h.user = null
    const res = await POST()
    expect(res.status).toBe(401)
    expect(h.upstreamCalls).toBe(0)
  })
})

describe('POST /api/v1/funds/refresh-nav — one upstream request', () => {
  it('hits the feed exactly once however many funds are being refreshed', async () => {
    h.funds = [
      { id: 'a', name: 'A', code: 'VCBF-BCF' },
      { id: 'b', name: 'B', code: 'VCBF-FIF' },
      { id: 'c', name: 'C', code: 'SSISCA' },
    ]
    h.navByCode = { VCBFBCF: 40789.29, VCBFFIF: 16024.72, SSISCA: 41110.8 }
    const res = await POST()
    expect(res.status).toBe(200)
    expect(h.upstreamCalls).toBe(1)
    const body = await res.json()
    expect(body.results).toHaveLength(3) // every fund still reported
  })

  // The bug that started this: VCBF's scraper mapped only three of its funds by
  // URL substring and let the rest silently take the bond fund's price, so
  // VCBF-BCF was stored ~60% low under a green "synced" pill. Sibling funds must
  // each get their own number.
  it('gives sibling funds from one provider their own distinct NAV', async () => {
    h.funds = [
      { id: 'a', name: 'Blue Chip', code: 'VCBF-BCF' },
      { id: 'b', name: 'Bond', code: 'VCBF-FIF' },
    ]
    h.navByCode = { VCBFBCF: 40789.29, VCBFFIF: 16024.72 }
    const res = await POST()
    const body = await res.json()
    const byCode = Object.fromEntries(body.results.map((r: { code: string }) => [r.code, r]))
    expect(byCode['VCBF-BCF'].nav).toBe(40789.29)
    expect(byCode['VCBF-FIF'].nav).toBe(16024.72)
  })
})

describe('POST /api/v1/funds/refresh-nav — partial failure (#515)', () => {
  it('reports a per-fund error for an unlisted code but still 200s with the successes', async () => {
    h.funds = [
      { id: 'a', name: 'A', code: 'DCDS' },
      { id: 'c', name: 'C', code: 'MYSTERY' },
    ]
    h.navByCode = { DCDS: 93915.08 }
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    const byCode = Object.fromEntries(body.results.map((r: { code: string }) => [r.code, r]))
    expect(byCode.DCDS.nav).toBe(93915.08)
    expect(byCode.MYSTERY.error).toMatch(/MYSTERY/)
  })

  // A total upstream outage must still render as per-fund rows the UI can show,
  // not as a request failure that reads like a broken app.
  it('reports the upstream error against every fund rather than failing the request', async () => {
    h.funds = [
      { id: 'a', name: 'A', code: 'DCDS' },
      { id: 'b', name: 'B', code: 'VESAF' },
    ]
    h.upstreamError = new Error('Upstream responded 503 for api.fmarket.vn')
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toHaveLength(2)
    for (const r of body.results) expect(r.error).toMatch(/503/)
  })

  it('reports a database failure against the affected funds', async () => {
    h.funds = [{ id: 'a', name: 'A', code: 'DCDS' }]
    h.navByCode = { DCDS: 93915.08 }
    h.updateError = { message: 'write failed' }
    const res = await POST()
    const body = await res.json()
    expect(body.results[0].error).toMatch(/database/i)
  })

  it('returns { results: [] } when the user has no funds with a source URL', async () => {
    h.funds = []
    const res = await POST()
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
    expect(h.upstreamCalls).toBe(0)
  })
})
