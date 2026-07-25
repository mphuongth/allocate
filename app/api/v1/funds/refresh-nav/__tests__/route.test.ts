import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/v1/funds/refresh-nav must not let one authenticated user fan out an
// unbounded number of outbound scrapes (#515): it rate-limits per user (429),
// de-duplicates funds by normalized NAV URL so each provider page is scraped
// once, and reports per-fund results without failing the whole request when a
// single provider errors.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  funds: [] as { id: string; name: string; code: string; nav_source_url: string }[],
  fundsError: null as unknown,
  rate: { allowed: true, retry_after_seconds: 0 } as { allowed: boolean; retry_after_seconds: number },
  rateError: null as unknown,
  scrapeByUrl: {} as Record<string, { nav: number } | { error: string }>,
  scrapeCalls: [] as string[],
  updateError: null as unknown,
}))

// scrapeFundNav is mocked so the route test controls per-URL outcomes and can
// count how many times each distinct URL was scraped (de-dup assertion).
vi.mock('@/lib/scrape-fund-nav', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scrape-fund-nav')>()
  return {
    ...actual,
    scrapeFundNav: vi.fn(async (url: string) => {
      h.scrapeCalls.push(url)
      return h.scrapeByUrl[url] ?? { error: 'no stub' }
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
      update: () => {
        let ids: string[] = []
        const upd: Record<string, unknown> = {
          in: (_col: string, vals: string[]) => { ids = vals; return upd },
          eq: () => upd,
          select: () => upd,
          then: (r: (v: unknown) => void) => r(updateResult(ids)),
        }
        return upd
      },
    }
    void name
    return chain
  }
  const updateResult = (ids: string[]) => {
    if (h.updateError) return { data: null, error: h.updateError }
    // echo back only the rows matched by .in('id', ids), like the real update
    const rows = h.funds.filter((f) => ids.includes(f.id))
    return { data: rows.map((f) => ({ id: f.id, name: f.name, code: f.code, nav: 123, updated_at: 'now' })), error: null }
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
  h.scrapeByUrl = {}
  h.scrapeCalls = []
  h.updateError = null
})

describe('POST /api/v1/funds/refresh-nav — rate limit (#515)', () => {
  it('returns 429 with Retry-After and does not scrape when the user is over the limit', async () => {
    h.rate = { allowed: false, retry_after_seconds: 42 }
    const res = await POST()
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
    expect(h.scrapeCalls).toHaveLength(0)
  })

  it('fails open (still refreshes) when the rate-limit RPC errors', async () => {
    // e.g. the RPC not migrated yet, or a transient DB error. The fan-out is
    // still bounded by de-dup + concurrency below, so we proceed rather than 500.
    h.rateError = { message: 'function does not exist' }
    h.funds = [{ id: 'a', name: 'A', code: 'A', nav_source_url: 'https://vcbf.com/ok' }]
    h.scrapeByUrl = { 'https://vcbf.com/ok': { nav: 10 } }
    const res = await POST()
    expect(res.status).toBe(200)
    expect(h.scrapeCalls).toHaveLength(1)
  })

  it('returns 401 when unauthenticated (before any rate-limit/scrape work)', async () => {
    h.user = null
    const res = await POST()
    expect(res.status).toBe(401)
    expect(h.scrapeCalls).toHaveLength(0)
  })
})

describe('POST /api/v1/funds/refresh-nav — de-duplication (#515)', () => {
  it('scrapes each distinct normalized URL exactly once even with many funds on it', async () => {
    h.funds = [
      { id: 'a', name: 'A', code: 'A', nav_source_url: 'https://vcbf.com/quy/fif' },
      { id: 'b', name: 'B', code: 'B', nav_source_url: 'https://vcbf.com/quy/fif/' }, // trailing slash → same
      { id: 'c', name: 'C', code: 'C', nav_source_url: 'https://ssiam.com.vn/x' },
    ]
    h.scrapeByUrl = {
      'https://vcbf.com/quy/fif': { nav: 10 },
      'https://ssiam.com.vn/x': { nav: 20 },
    }
    const res = await POST()
    expect(res.status).toBe(200)
    // 3 funds, but only 2 distinct normalized URLs → 2 scrapes.
    expect(h.scrapeCalls).toHaveLength(2)
    const body = await res.json()
    expect(body.results).toHaveLength(3) // every fund still reported
  })
})

describe('POST /api/v1/funds/refresh-nav — partial scraper failure (#515)', () => {
  it('reports a per-fund error for the failed URL but still 200s with the successes', async () => {
    h.funds = [
      { id: 'a', name: 'A', code: 'A', nav_source_url: 'https://vcbf.com/ok' },
      { id: 'c', name: 'C', code: 'C', nav_source_url: 'https://ssiam.com.vn/bad' },
    ]
    h.scrapeByUrl = {
      'https://vcbf.com/ok': { nav: 10 },
      'https://ssiam.com.vn/bad': { error: 'NAV not found' },
    }
    const res = await POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    const byCode = Object.fromEntries(body.results.map((r: { code: string }) => [r.code, r]))
    expect(byCode.A.nav).toBeDefined()
    expect(byCode.C.error).toBe('NAV not found')
  })

  it('returns { results: [] } when the user has no funds with a source URL', async () => {
    h.funds = []
    const res = await POST()
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([])
    expect(h.scrapeCalls).toHaveLength(0)
  })
})
