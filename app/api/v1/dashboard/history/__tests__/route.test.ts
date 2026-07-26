import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// With fewer than two usable net-worth snapshots the chart falls back to
// synthesizing history from investment transactions. That fallback query dropped
// its error and the `!txData` branch treats the failure exactly like "this user
// has no transactions" — returning the 0-or-1 snapshots as the whole history
// (#533).
//
// So a transient read failure renders as a flat or empty net-worth chart on an
// account that actually holds money. Genuinely having no transactions must stay
// a 200; a failed read must not.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      then: (resolve: (v: unknown) => void) =>
        resolve(h.results[table] ?? { data: [], error: null }),
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chainFor(table),
    }),
  }
})

const { GET } = await import('../route')

const req = () => new Request('https://app.test/api/v1/dashboard/history?range=all')

describe('GET /api/v1/dashboard/history', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.results = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns real snapshots when there are at least two', async () => {
    h.results.net_worth_snapshots = {
      data: [
        { snapshot_date: '2026-06-01', total_assets: 100 },
        { snapshot_date: '2026-07-01', total_assets: 150 },
      ],
      error: null,
    }
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[1].value).toBe(150)
  })

  it('fails closed with 500 when the snapshot read errors', async () => {
    h.results.net_worth_snapshots = { data: null, error: { message: 'timeout' } }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('synthesizes history from transactions when snapshots are insufficient', async () => {
    h.results.net_worth_snapshots = { data: [], error: null }
    h.results.active_investment_transactions = {
      data: [
        { investment_date: '2026-05-10', amount_vnd: 100 },
        { investment_date: '2026-06-10', amount_vnd: 50 },
      ],
      error: null,
    }
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[1].value).toBe(150) // running cumulative
  })

  it('returns an empty history for an account with no snapshots and no transactions', async () => {
    h.results.net_worth_snapshots = { data: [], error: null }
    h.results.active_investment_transactions = { data: [], error: null }
    const res = await GET(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual([])
  })

  // The dangerous shape: the account holds money, but the fallback read failed.
  // Silently returning the lone snapshot renders a flat chart that looks real.
  it('fails closed with 500 when the transaction fallback read errors', async () => {
    h.results.net_worth_snapshots = {
      data: [{ snapshot_date: '2026-07-01', total_assets: 150 }],
      error: null,
    }
    h.results.active_investment_transactions = { data: null, error: { message: 'timeout' } }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('does not leak the database message to the client', async () => {
    h.results.net_worth_snapshots = { data: [], error: null }
    h.results.active_investment_transactions = {
      data: null,
      error: { message: 'relation "active_investment_transactions" does not exist' },
    }
    const res = await GET(req())
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
