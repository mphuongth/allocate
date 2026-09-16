import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// The challenge's collection endpoint: read a month, and start one.
//
// Two things are worth pinning here rather than trusting to the client. A read
// that FAILS must not degrade into "no challenge yet" — that is the shape the
// UI uses to offer the tier picker, so a transient error would invite the user
// to start a month they already started, and the 409 they'd get back would be
// the first they heard of it. And the month a challenge can be started for is
// the current one: a past month is history, a future one hasn't begun, and
// either would produce a challenge with nothing tickable in it.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  results: {} as Record<string, { data: unknown; error: unknown }>,
  inserted: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = (table: string) => {
    const settle = (resolve: (v: unknown) => void) =>
      resolve(h.results[table] ?? { data: null, error: null })
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: (row: unknown) => { h.inserted.push(row); return chain },
      single: () => chain,
      maybeSingle: () => chain,
      then: settle,
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

const { GET, POST } = await import('../route')

// Pinned to 07:30 on 16 September 2026 in Vietnam — inside the UTC window where
// the calendar date is still the 15th.
const NOW = new Date('2026-09-16T00:30:00Z')

const get = (query: string) =>
  new Request(`https://app.test/api/v1/savings-challenges${query}`) as unknown as NextRequest

const post = (body: unknown) =>
  new Request('https://app.test/api/v1/savings-challenges', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.results = {}
  h.inserted = []
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GET /api/v1/savings-challenges', () => {
  it('refuses an unauthenticated read', async () => {
    h.user = null
    expect((await GET(get('?year=2026&month=9'))).status).toBe(401)
  })

  it('needs a year and a month it can believe', async () => {
    expect((await GET(get(''))).status).toBe(400)
    expect((await GET(get('?year=2026'))).status).toBe(400)
    expect((await GET(get('?year=2026&month=13'))).status).toBe(400)
    expect((await GET(get('?year=2026&month=0'))).status).toBe(400)
    expect((await GET(get('?year=1800&month=9'))).status).toBe(400)
    expect((await GET(get('?year=abc&month=9'))).status).toBe(400)
  })

  it('says so plainly when the month has no challenge', async () => {
    h.results.savings_challenges = { data: null, error: null }
    const res = await GET(get('?year=2026&month=9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ challenge: null, days: [] })
  })

  it('returns the month with its ticked days as bare numbers', async () => {
    h.results.savings_challenges = {
      data: { challenge_id: 'c-1', year: 2026, month: 9, tier: 2 },
      error: null,
    }
    h.results.savings_challenge_days = { data: [{ day: 3 }, { day: 1 }], error: null }

    const res = await GET(get('?year=2026&month=9'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      challenge: { challenge_id: 'c-1', year: 2026, month: 9, tier: 2 },
      days: [3, 1],
    })
  })

  it('reports a failed challenge read as an error, not as an empty month', async () => {
    h.results.savings_challenges = { data: null, error: { message: 'boom' } }
    expect((await GET(get('?year=2026&month=9'))).status).toBe(500)
  })

  it('reports a failed day read as an error, not as an untouched month', async () => {
    // The dangerous direction: an empty day list unlocks the tier picker and
    // tells the user they have saved nothing this month.
    h.results.savings_challenges = {
      data: { challenge_id: 'c-1', year: 2026, month: 9, tier: 1 },
      error: null,
    }
    h.results.savings_challenge_days = { data: null, error: { message: 'boom' } }
    expect((await GET(get('?year=2026&month=9'))).status).toBe(500)
  })
})

describe('POST /api/v1/savings-challenges', () => {
  it('refuses an unauthenticated write', async () => {
    h.user = null
    expect((await POST(post({ year: 2026, month: 9, tier: 1 }))).status).toBe(401)
  })

  it('takes one of the three tiers and nothing else', async () => {
    for (const tier of [0, 4, 2.5, '2', null, undefined]) {
      const res = await POST(post({ year: 2026, month: 9, tier }))
      expect(res.status).toBe(400)
    }
  })

  it('starts the current month, stamping the row with the caller', async () => {
    h.results.savings_challenges = {
      data: { challenge_id: 'c-1', year: 2026, month: 9, tier: 3 },
      error: null,
    }
    const res = await POST(post({ year: 2026, month: 9, tier: 3 }))
    expect(res.status).toBe(201)
    expect(h.inserted).toEqual([{ user_id: 'user-1', year: 2026, month: 9, tier: 3 }])
  })

  it('will not start a month that has already been and gone', async () => {
    const res = await POST(post({ year: 2026, month: 8, tier: 1 }))
    expect(res.status).toBe(409)
    expect(h.inserted).toEqual([])
  })

  it('will not start a month that has not begun', async () => {
    const res = await POST(post({ year: 2026, month: 10, tier: 1 }))
    expect(res.status).toBe(409)
    expect(h.inserted).toEqual([])
  })

  it('answers a month that is already under way with a conflict', async () => {
    h.results.savings_challenges = { data: null, error: { code: '23505', message: 'duplicate key' } }
    const res = await POST(post({ year: 2026, month: 9, tier: 1 }))
    expect(res.status).toBe(409)
  })
})
