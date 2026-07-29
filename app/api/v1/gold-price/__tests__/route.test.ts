import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The gold-price read dropped its Supabase error and returned `data ?? null`, so
// a database outage was indistinguishable from "this user has never set a gold
// price" — both rendered as "no price" (#533).
//
// Fixing that is not just an `if (error)` away: the query used `.single()`, which
// PostgREST answers with a PGRST116 *error* when no row matches. Bolting a 500
// onto the error path while keeping `.single()` would turn every first-time user
// into a server error. The mock below therefore reproduces real PostgREST
// semantics — `single()` errors on a missing row, `maybeSingle()` does not — so
// the missing-row test genuinely pins the `.maybeSingle()` switch.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  dbError: null as { code?: string; message: string } | null,
  selects: [] as string[],
}))

const PGRST116 = {
  code: 'PGRST116',
  message: 'JSON object requested, multiple (or no) rows returned',
}

vi.mock('@/lib/supabase-server', () => {
  const settle = (kind: 'single' | 'maybeSingle') => {
    if (h.dbError) return { data: null, error: h.dbError }
    if (h.row === null && kind === 'single') return { data: null, error: PGRST116 }
    return { data: h.row, error: null }
  }
  const chain: Record<string, unknown> = {
    select: (cols: string) => {
      h.selects.push(cols)
      return chain
    },
    eq: () => chain,
    single: async () => settle('single'),
    maybeSingle: async () => settle('maybeSingle'),
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
    }),
  }
})

const { GET } = await import('../route')

const PRICE_ROW = {
  price_per_chi: 8_500_000,
  previous_price_per_chi: 8_400_000,
  updated_at: '2026-07-26T00:00:00.000Z',
}

describe('GET /api/v1/gold-price', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.row = null
    h.dbError = null
    h.selects = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns the stored gold price', async () => {
    h.row = PRICE_ROW
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual(PRICE_ROW)
  })

  it('returns null when the user has no gold settings yet', async () => {
    h.row = null
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toBeNull()
  })

  it('fails closed with 500 when the read errors', async () => {
    h.dbError = { message: 'connection reset by peer' }
    const res = await GET()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.not.toBeNull()
  })

  it('does not leak the database message to the client', async () => {
    h.dbError = { message: 'connection reset by peer' }
    const res = await GET()
    expect(JSON.stringify(await res.json())).not.toContain('connection reset')
  })

  // previous_price_per_chi has no consumer today — this route returns it and
  // useGoalDetailData reads only price_per_chi. That absence is deliberate
  // (#548, option 2), which is exactly what makes the field an inviting target
  // for a "drop the unused column" cleanup.
  //
  // The response-body assertion above cannot protect it: the route could ask for
  // price_per_chi alone and still pass, because it echoes back whatever the mock
  // supplies regardless of what was requested. This pins the request instead.
  // gold_price_previous_column.test.sql guards the column itself; this guards the
  // only link between that column and the client.
  it('asks the database for previous_price_per_chi even though no UI reads it yet', async () => {
    h.row = PRICE_ROW
    await GET()
    expect(h.selects).toHaveLength(1)
    expect(h.selects[0]).toContain('previous_price_per_chi')
  })
})
