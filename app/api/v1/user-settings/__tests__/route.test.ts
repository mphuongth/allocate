import { describe, it, expect, vi, beforeEach } from 'vitest'

// The user's inflation assumption is a planning position, and this route is the
// only way it moves. Two properties are load-bearing and neither is obvious:
//
//  · NULL and 0 are different answers. NULL is "I have not chosen", which the
//    client answers with the app default; 0 is "assume no inflation", a position
//    the user took. A route that coalesced them would silently attribute an
//    assumption to someone who never made one — the same distinction the column
//    is nullable for (20260905000001).
//  · A missing row is not an error. Every user starts without one, so the read
//    must answer "nothing chosen" rather than 500 — the mock below reproduces
//    PostgREST's real semantics (single() errors on no rows, maybeSingle()
//    doesn't) so the .maybeSingle() choice is genuinely pinned (cf. #533).

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  dbError: null as { code?: string; message: string } | null,
  upserts: [] as Record<string, unknown>[],
}))

const PGRST116 = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () => (h.dbError ? { data: null, error: h.dbError } : h.row === null ? { data: null, error: PGRST116 } : { data: h.row, error: null }),
    maybeSingle: async () => (h.dbError ? { data: null, error: h.dbError } : { data: h.row, error: null }),
    upsert: async (payload: Record<string, unknown>) => {
      h.upserts.push(payload)
      return h.dbError ? { error: h.dbError } : { error: null }
    },
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
    }),
  }
})

const { GET, PUT } = await import('../route')

const put = (body: unknown) =>
  PUT(new Request('http://localhost/api/v1/user-settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never)

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.row = null
  h.dbError = null
  h.upserts = []
})

describe('GET /api/v1/user-settings', () => {
  it('rejects an unauthenticated read', async () => {
    h.user = null
    expect((await GET()).status).toBe(401)
  })

  it('answers "nothing chosen" for a user who has never set a rate', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ inflation_rate_pct: null })
  })

  it('returns the stored rate', async () => {
    h.row = { inflation_rate_pct: 4.5 }
    expect(await (await GET()).json()).toEqual({ inflation_rate_pct: 4.5 })
  })

  it('keeps an explicit zero distinct from "not chosen"', async () => {
    h.row = { inflation_rate_pct: 0 }
    expect(await (await GET()).json()).toEqual({ inflation_rate_pct: 0 })
  })

  it('reports a read failure instead of passing it off as "not chosen"', async () => {
    h.dbError = { message: 'connection reset' }
    expect((await GET()).status).toBe(500)
  })
})

describe('PUT /api/v1/user-settings', () => {
  it('rejects an unauthenticated write', async () => {
    h.user = null
    expect((await put({ inflation_rate_pct: 4 })).status).toBe(401)
  })

  it('stores a rate against the calling user, never a supplied id', async () => {
    const res = await put({ inflation_rate_pct: 4.5, user_id: 'someone-else' })
    expect(res.status).toBe(200)
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0].user_id).toBe('user-1')
    expect(h.upserts[0].inflation_rate_pct).toBe(4.5)
  })

  it('stores an explicit zero as zero', async () => {
    await put({ inflation_rate_pct: 0 })
    expect(h.upserts[0].inflation_rate_pct).toBe(0)
  })

  it('clears the assumption back to "not chosen" on null', async () => {
    await put({ inflation_rate_pct: null })
    expect(h.upserts[0].inflation_rate_pct).toBeNull()
  })

  it('stamps updated_at so the Settings card can say when it was last reviewed', async () => {
    await put({ inflation_rate_pct: 4 })
    expect(typeof h.upserts[0].updated_at).toBe('string')
  })

  it.each([
    ['above the ceiling', 101],
    ['negative', -1],
    ['not a number', 'soon'],
    ['blank', ''],
    // Not Infinity/NaN: JSON.stringify turns both into `null`, which is a
    // different request (clear the assumption) and would pass for the wrong
    // reason. A boolean is what a sloppy client actually sends.
    ['a boolean', true],
  ])('refuses a rate that is %s', async (_label, value) => {
    const res = await put({ inflation_rate_pct: value })
    expect(res.status).toBe(400)
    expect(h.upserts).toHaveLength(0)
  })

  it('refuses a body that omits the field entirely — silence is not "clear it"', async () => {
    expect((await put({})).status).toBe(400)
    expect(h.upserts).toHaveLength(0)
  })

  it('reports a write failure', async () => {
    h.dbError = { message: 'disk full' }
    expect((await put({ inflation_rate_pct: 4 })).status).toBe(500)
  })
})
