import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// The list endpoint optionally narrows to the expenses active in a plan month by
// interpolating ?month= and ?year= into a PostgREST `.or(...)` filter STRING,
// where a comma starts a new term. Unvalidated, a value could rewrite the
// expression rather than be compared against it, and a malformed one produced an
// opaque database error instead of a clear 400 (#534).
//
// The filter itself is asserted here too: validation that quietly stopped the
// narrowing from happening would be its own bug.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  result: { data: [] as unknown[], error: null as unknown },
  orFilters: [] as string[],
  eqFilters: [] as [string, unknown][],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = () => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, val: unknown) => { h.eqFilters.push([col, val]); return c },
      or: (expr: string) => { h.orFilters.push(expr); return c },
      order: () => c,
      then: (resolve: (v: unknown) => void) => resolve(h.result),
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain(),
    }),
  }
})

const { GET } = await import('../route')

const req = (query = '') =>
  new Request(`https://app.test/api/v1/fixed-expenses${query}`) as unknown as NextRequest

describe('GET /api/v1/fixed-expenses', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.result = { data: [], error: null }
    h.orFilters = []
    h.eqFilters = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    expect((await GET(req())).status).toBe(401)
  })

  it('serves the unfiltered list when no month is supplied', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(h.orFilters).toEqual([])
  })

  it('applies the plan-month filter for a valid month and year', async () => {
    const res = await GET(req('?month=6&year=2026'))
    expect(res.status).toBe(200)
    expect(h.orFilters).toEqual([
      'effective_from.is.null,effective_from.lte.2026-06-01',
      'effective_to.is.null,effective_to.gte.2026-06-01',
    ])
  })

  it('zero-pads a single-digit month in the filter', async () => {
    await GET(req('?month=9&year=2026'))
    expect(h.orFilters[0]).toContain('2026-09-01')
  })

  it('still applies the category filter alongside the plan month', async () => {
    await GET(req('?category=housing&month=6&year=2026'))
    expect(h.eqFilters).toContainEqual(['category', 'housing'])
    expect(h.orFilters).toHaveLength(2)
  })

  it('rejects a malformed month before querying', async () => {
    const res = await GET(req('?month=6abc&year=2026'))
    expect(res.status).toBe(400)
    expect(h.orFilters).toEqual([])
  })

  it('rejects a month outside 1-12', async () => {
    expect((await GET(req('?month=0&year=2026'))).status).toBe(400)
    expect((await GET(req('?month=13&year=2026'))).status).toBe(400)
  })

  it('rejects a year outside the supported range', async () => {
    expect((await GET(req('?month=6&year=1999'))).status).toBe(400)
    expect((await GET(req('?month=6&year=10000'))).status).toBe(400)
  })

  // The value would otherwise be spliced into the .or(...) expression verbatim.
  it('rejects a value carrying PostgREST filter syntax', async () => {
    const res = await GET(req('?month=6&year=' + encodeURIComponent('2026,effective_from.gte.1900-01-01')))
    expect(res.status).toBe(400)
    expect(h.orFilters).toEqual([])
  })

  it('rejects month without year rather than silently dropping the filter', async () => {
    const res = await GET(req('?month=6'))
    expect(res.status).toBe(400)
  })

  it('rejects year without month', async () => {
    expect((await GET(req('?year=2026'))).status).toBe(400)
  })

  it('fails closed with 500 when the read errors', async () => {
    h.result = { data: [], error: { message: 'timeout' } }
    expect((await GET(req())).status).toBe(500)
  })
})
