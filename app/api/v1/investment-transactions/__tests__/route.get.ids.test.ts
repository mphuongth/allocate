import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// `ids` fetches a named set of transactions in one round trip (#638). Goal
// detail uses it for the book anchors that fell outside its 200-row page: a
// book's terms live on the anchor, and without them the page reads a tranche
// that knows none of them. One request, not one per anchor.

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  inCalls: [] as { column: string; values: unknown }[],
}))

vi.mock('@/lib/supabase-server', () => {
  const q: Record<string, unknown> = {}
  const chain = () => {
    Object.assign(q, {
      select: () => q, eq: () => q, is: () => q, gte: () => q, lte: () => q,
      order: () => q, range: () => q,
      in: (column: string, values: unknown) => { h.inCalls.push({ column, values }); return q },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }),
    })
    return q
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain(),
    }),
  }
})

const { GET } = await import('../route')

const get = (query: string) =>
  GET(new Request(`https://app.test/api/v1/investment-transactions?${query}`) as unknown as NextRequest)

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.inCalls = []
})

describe('GET /api/v1/investment-transactions — ids (#638)', () => {
  it('filters to the requested set', async () => {
    const res = await get(`ids=${ID_A},${ID_B}&include_history=true`)

    expect(res.status).toBe(200)
    expect(h.inCalls).toEqual([{ column: 'transaction_id', values: [ID_A, ID_B] }])
  })

  it('does not filter when ids is absent', async () => {
    await get('goal_id=g1')

    expect(h.inCalls).toHaveLength(0)
  })

  it('rejects a malformed id rather than filtering on garbage', async () => {
    const res = await get('ids=not-a-uuid')

    expect(res.status).toBe(400)
    expect(h.inCalls).toHaveLength(0)
  })

  it('refuses an unbounded set', async () => {
    const res = await get(`ids=${Array.from({ length: 101 }, () => ID_A).join(',')}`)

    expect(res.status).toBe(400)
    expect(h.inCalls).toHaveLength(0)
  })
})
