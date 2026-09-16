import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Re-tiering a month, abandoning it, and ticking a day off.
//
// The database is what actually holds the line — the tier freezes at the first
// tick, and a day's amount is recomputed and refused if it disagrees. What these
// routes owe the caller is that its refusals arrive as answers rather than as a
// 500 with a generic message, and that the one rule the database deliberately
// does NOT hold (a challenge is only writable during its own month) is applied
// consistently across all four handlers.
//
// The amount is the other half: the client never sends one. A route that took
// `amount_vnd` from the body would be relying on the trigger to catch a lie, and
// a trigger is a last line, not a contract.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  challenge: null as unknown,
  challengeError: null as unknown,
  writeResult: { data: null as unknown, error: null as unknown },
  ops: [] as Array<{ table: string; op: string; payload?: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  // One chain per from() call, and what it IS is decided by whether a write verb
  // was used — not by the presence of select(), since every write here ends in
  // `.select().single()` to return the row it wrote.
  const chainFor = (table: string) => {
    let writing = false
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      update: (row: unknown) => { writing = true; h.ops.push({ table, op: 'update', payload: row }); return chain },
      insert: (row: unknown) => { writing = true; h.ops.push({ table, op: 'insert', payload: row }); return chain },
      delete: () => { writing = true; h.ops.push({ table, op: 'delete' }); return chain },
      single: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (v: unknown) => void) => {
        if (!writing && table === 'savings_challenges') {
          return resolve({ data: h.challenge, error: h.challengeError })
        }
        return resolve(h.writeResult)
      },
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

const { PATCH, DELETE } = await import('../route')
const { POST: TICK } = await import('../days/route')
const { DELETE: UNTICK } = await import('../days/[day]/route')

// 07:30 on 16 September 2026 in Vietnam — a 30-day month, sixteen days in.
const NOW = new Date('2026-09-16T00:30:00Z')
const ID = '11111111-1111-4111-8111-111111111111'
const SEPTEMBER = { challenge_id: ID, year: 2026, month: 9, tier: 1 }

const params = () => ({ params: Promise.resolve({ id: ID }) })
const dayParams = (day: string) => ({ params: Promise.resolve({ id: ID, day }) })

const body = (payload: unknown, method = 'POST') =>
  new Request(`https://app.test/api/v1/savings-challenges/${ID}`, {
    method,
    body: JSON.stringify(payload),
  }) as unknown as NextRequest

const bare = (method = 'DELETE') =>
  new Request(`https://app.test/api/v1/savings-challenges/${ID}`, { method }) as unknown as NextRequest

const locked = { message: 'savings challenge: the tier is locked once a day has been set aside' }

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.challenge = SEPTEMBER
  h.challengeError = null
  h.writeResult = { data: { id: 'd-1' }, error: null }
  h.ops = []
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PATCH /api/v1/savings-challenges/[id]', () => {
  it('refuses an unauthenticated write', async () => {
    h.user = null
    expect((await PATCH(body({ tier: 2 }, 'PATCH'), params())).status).toBe(401)
  })

  it('rejects an id that is not a uuid', async () => {
    const res = await PATCH(body({ tier: 2 }, 'PATCH'), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    expect(res.status).toBe(400)
  })

  it('takes one of the three tiers and nothing else', async () => {
    for (const tier of [0, 4, '2', null]) {
      expect((await PATCH(body({ tier }, 'PATCH'), params())).status).toBe(400)
    }
    expect(h.ops.filter(o => o.op === 'update')).toEqual([])
  })

  it("does not find someone else's challenge", async () => {
    h.challenge = null
    expect((await PATCH(body({ tier: 2 }, 'PATCH'), params())).status).toBe(404)
  })

  it('does not mistake a failed lookup for a missing challenge', async () => {
    h.challenge = null
    h.challengeError = { message: 'boom' }
    expect((await PATCH(body({ tier: 2 }, 'PATCH'), params())).status).toBe(500)
  })

  it('changes the tier while the month is still open', async () => {
    h.writeResult = { data: { ...SEPTEMBER, tier: 3 }, error: null }
    const res = await PATCH(body({ tier: 3 }, 'PATCH'), params())
    expect(res.status).toBe(200)
    expect(h.ops).toContainEqual({
      table: 'savings_challenges', op: 'update', payload: { tier: 3, updated_at: expect.any(String) },
    })
  })

  it("passes the database's lock refusal through as a conflict, in its own words", async () => {
    h.writeResult = { data: null, error: locked }
    const res = await PATCH(body({ tier: 3 }, 'PATCH'), params())
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('challenge_locked')
    expect(json.error).toBe('the tier is locked once a day has been set aside')
  })

  it('will not re-tier a month that has ended', async () => {
    h.challenge = { ...SEPTEMBER, month: 8 }
    const res = await PATCH(body({ tier: 3 }, 'PATCH'), params())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('challenge_month_closed')
    expect(h.ops.filter(o => o.op === 'update')).toEqual([])
  })
})

describe('DELETE /api/v1/savings-challenges/[id]', () => {
  it('abandons an untouched month', async () => {
    h.writeResult = { data: null, error: null }
    const res = await DELETE(bare(), params())
    expect(res.status).toBe(204)
    expect(h.ops).toContainEqual({ table: 'savings_challenges', op: 'delete' })
  })

  it('will not abandon a month with days already ticked', async () => {
    h.writeResult = { data: null, error: locked }
    const res = await DELETE(bare(), params())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('challenge_locked')
  })

  it('will not touch a month that has ended', async () => {
    h.challenge = { ...SEPTEMBER, month: 8 }
    expect((await DELETE(bare(), params())).status).toBe(409)
    expect(h.ops.filter(o => o.op === 'delete')).toEqual([])
  })
})

describe('POST /api/v1/savings-challenges/[id]/days', () => {
  it('derives the amount itself rather than believing the client', async () => {
    // Day 16 of a 30-day tier-1 month is (30 + 1 - 16) x 1,000.
    const res = await TICK(body({ day: 16, amount_vnd: 999_999 }), params())
    expect(res.status).toBe(201)
    expect(h.ops).toContainEqual({
      table: 'savings_challenge_days',
      op: 'insert',
      payload: { challenge_id: ID, day: 16, amount_vnd: 15_000 },
    })
  })

  it('ticks a day that has already passed', async () => {
    await TICK(body({ day: 1 }), params())
    expect(h.ops).toContainEqual({
      table: 'savings_challenge_days',
      op: 'insert',
      payload: { challenge_id: ID, day: 1, amount_vnd: 30_000 },
    })
  })

  it('will not tick a day that has not happened yet', async () => {
    const res = await TICK(body({ day: 17 }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('challenge_day_future')
    expect(h.ops.filter(o => o.op === 'insert')).toEqual([])
  })

  it('will not tick a day the month does not have', async () => {
    expect((await TICK(body({ day: 31 }), params())).status).toBe(409)
    expect((await TICK(body({ day: 0 }), params())).status).toBe(400)
    expect((await TICK(body({ day: 'x' }), params())).status).toBe(400)
    expect(h.ops.filter(o => o.op === 'insert')).toEqual([])
  })

  it('treats a day already ticked as done, not as an error', async () => {
    // A double-tap on a checkbox is not a mistake worth reporting. The end state
    // the caller asked for is the one they already have.
    h.writeResult = { data: null, error: { code: '23505', message: 'duplicate key' } }
    expect((await TICK(body({ day: 5 }), params())).status).toBe(200)
  })

  it('will not tick into a month that has ended', async () => {
    h.challenge = { ...SEPTEMBER, month: 8 }
    const res = await TICK(body({ day: 5 }), params())
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('challenge_month_closed')
  })
})

describe('DELETE /api/v1/savings-challenges/[id]/days/[day]', () => {
  it('un-ticks a day', async () => {
    h.writeResult = { data: null, error: null }
    const res = await UNTICK(bare(), dayParams('16'))
    expect(res.status).toBe(204)
    expect(h.ops).toContainEqual({ table: 'savings_challenge_days', op: 'delete' })
  })

  it('un-ticks a day that is no longer tickable but is still in the month', async () => {
    // Nothing about undoing a mistake requires the day to be re-doable, and the
    // whole month stays undoable until it ends — which is what keeps the tier
    // lock symmetrical with the tick that set it.
    h.writeResult = { data: null, error: null }
    expect((await UNTICK(bare(), dayParams('1'))).status).toBe(204)
  })

  it('rejects a day outside the calendar', async () => {
    expect((await UNTICK(bare(), dayParams('0'))).status).toBe(400)
    expect((await UNTICK(bare(), dayParams('32'))).status).toBe(400)
    expect((await UNTICK(bare(), dayParams('x'))).status).toBe(400)
    expect(h.ops.filter(o => o.op === 'delete')).toEqual([])
  })

  it('will not un-tick a month that has ended', async () => {
    h.challenge = { ...SEPTEMBER, month: 8 }
    expect((await UNTICK(bare(), dayParams('5'))).status).toBe(409)
    expect(h.ops.filter(o => o.op === 'delete')).toEqual([])
  })
})
