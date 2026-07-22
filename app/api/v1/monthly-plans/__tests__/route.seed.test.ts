import { describe, it, expect, vi, beforeEach } from 'vitest'

// The full-load GET seeds DCA rows via the seed_and_sync_plan_dca RPC before it
// reads anything. A failed seed must surface as a non-200 (#466) rather than
// silently returning a half-seeded plan — this pins that branch down at the
// route layer, mocking the RPC result.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  plan: { id: 'plan-1', user_id: 'user-1', month: 11, year: 2099 } as Record<string, unknown> | null,
  planError: null as unknown,
  rpcError: null as unknown,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    or: () => chain,
    maybeSingle: async () => ({ data: h.plan, error: h.planError }),
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
      rpc: async (fn: string, args: unknown) => {
        h.rpcCalls.push({ fn, args })
        return { error: h.rpcError }
      },
    }),
  }
})

import { GET } from '../route'

function makeReq(query: string) {
  return { url: `http://localhost/api/v1/monthly-plans?${query}` } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.plan = { id: 'plan-1', user_id: 'user-1', month: 11, year: 2099 }
  h.planError = null
  h.rpcError = null
  h.rpcCalls = []
})

describe('GET /api/v1/monthly-plans — DCA seed failure handling (#466)', () => {
  it('returns 500 when the seed RPC fails on a full load', async () => {
    h.rpcError = { message: 'insert or update failed' }
    const res = await GET(makeReq('month=11&year=2099&full=true'))
    expect(res.status).toBe(500)
    // It must fail on the seed, before doing any reads.
    expect(h.rpcCalls).toEqual([{ fn: 'seed_and_sync_plan_dca', args: { p_plan_id: 'plan-1' } }])
  })

  it('does not seed (or fail) for a non-full load', async () => {
    h.rpcError = { message: 'should never be reached' }
    const res = await GET(makeReq('month=11&year=2099'))
    expect(res.status).toBe(200)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('still 404s a missing plan without seeding', async () => {
    h.plan = null
    const res = await GET(makeReq('month=11&year=2099&full=true'))
    expect(res.status).toBe(404)
    expect(h.rpcCalls).toHaveLength(0)
  })
})
