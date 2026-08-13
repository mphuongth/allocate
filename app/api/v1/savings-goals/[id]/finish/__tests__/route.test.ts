import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// POST /api/v1/savings-goals/:id/finish — the route around the atomic RPC (#650).
//
// The liquidation itself is the database's job (supabase/tests/finish_savings_goal
// .test.sql); what is tested here is everything the route decides on its own: who
// may call it, which completion value it archives, and how each of the database's
// refusals reaches the user. A finish that fails must say WHY — "Failed to finish
// the goal" on a blocked goal sends the user hunting through their plan.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  goal: { goal_id: '', goal_name: 'New kitchen', completed_at: null as string | null } as Record<string, unknown> | null,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: {} as unknown, error: null as { message: string } | null },
  blockers: { data: [] as unknown[], error: null as { message: string } | null },
  overview: { ok: true, data: { goals: [] as Array<Record<string, unknown>> } } as unknown,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.goal, error: null }),
      }
      return chain
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpc.push({ fn, args })
      return fn === 'savings_goal_finish_blockers' ? h.blockers : h.rpcResult
    },
  }),
}))

vi.mock('@/lib/dashboardOverview', () => ({
  buildDashboardOverview: async () => h.overview,
}))

const { GET, POST } = await import('../route')

const GOAL_ID = '33333333-3333-4333-8333-333333333333'
const PLAN = [{ key: 'tx:abc', received: 1_000_000 }]

const post = (body: unknown, id: string = GOAL_ID) =>
  POST(
    new Request(`https://app.test/api/v1/savings-goals/${id}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

const get = (id: string = GOAL_ID) =>
  GET(new Request(`https://app.test/api/v1/savings-goals/${id}/finish`) as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.goal = { goal_id: GOAL_ID, goal_name: 'New kitchen', completed_at: null }
  h.rpc = []
  h.rpcResult = { data: { realized: 30_000_000, holdings: 4, completion_value: 26_000_000 }, error: null }
  h.blockers = { data: [], error: null }
  h.overview = { ok: true, data: { goals: [{ goalId: GOAL_ID, currentValue: 25_000_000, progressValue: 26_000_000 }] } }
})

describe('GET (blockers)', () => {
  it('names what still feeds the goal', async () => {
    h.blockers = { data: [{ code: 'recurring_saving', label: 'Gửi góp hàng tháng' }], error: null }
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      blockers: [{ code: 'recurring_saving', label: 'Gửi góp hàng tháng' }],
      completed: false,
    })
  })

  it('404s a goal that is not the caller\'s', async () => {
    h.goal = null
    expect((await get()).status).toBe(404)
  })
})

describe('POST', () => {
  it('archives at the goal\'s PROGRESS value, not the cash the liquidation raised', async () => {
    // A goal partly spent before it was finished has already released value
    // through affects_progress=false withdrawals. Archiving the realized cash
    // would record it as having achieved less than it did.
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(200)
    expect(h.rpc.find((c) => c.fn === 'finish_savings_goal')?.args.p_completion_value).toBe(26_000_000)
    expect(await res.json()).toMatchObject({ realized: 30_000_000, holdings: 4, completionPercentage: 100 })
  })

  it('falls back to the current value when the goal has no progress figure', async () => {
    h.overview = { ok: true, data: { goals: [{ goalId: GOAL_ID, currentValue: 25_000_000 }] } }
    await post({ plan: PLAN })
    expect(h.rpc[0].args.p_completion_value).toBe(25_000_000)
  })

  it('passes the plan through as sent, rounded to the đồng', async () => {
    await post({ plan: [{ key: 'tx:abc', received: 1_000_000.6 }] })
    expect(h.rpc[0].args.p_plan).toEqual([{ key: 'tx:abc', received: 1_000_001 }])
  })

  it('rejects an unauthenticated caller before touching the ledger', async () => {
    h.user = null
    expect((await post({ plan: PLAN })).status).toBe(401)
    expect(h.rpc).toHaveLength(0)
  })

  it('rejects a plan that is not an array', async () => {
    const res = await post({ plan: 'everything' })
    expect(res.status).toBe(400)
    expect(h.rpc).toHaveLength(0)
  })

  it('rejects a negative realization', async () => {
    const res = await post({ plan: [{ key: 'tx:abc', received: -1 }] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('non-negative')
  })

  it('refuses to finish an already-completed goal', async () => {
    h.goal = { goal_id: GOAL_ID, goal_name: 'New kitchen', completed_at: '2026-08-01T00:00:00Z' }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_completed')
    expect(h.rpc).toHaveLength(0)
  })

  it('says which kind of thing still feeds the goal', async () => {
    h.rpcResult = { data: null, error: { message: 'finish goal blocked: dca_plan VESAF' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('blocked_dca_plan')
    expect(body.blocker).toBe('dca_plan VESAF')
  })

  it('tells the user to reload when the plan no longer matches the goal', async () => {
    h.rpcResult = { data: null, error: { message: 'finish goal: the liquidation plan leaves holding tx:x unrealized' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('stale_plan')
    expect(body.error).toBe('the liquidation plan leaves holding tx:x unrealized')
  })

  it('reports a refused withdrawal as a change that did not happen', async () => {
    h.rpcResult = { data: null, error: { message: 'withdrawal invariant: 5 exceeds the remaining balance of 3 on this holding' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('liquidation_refused')
    expect(body.error).toContain('nothing was changed')
  })

  it('names a promised handover rather than reporting a server fault', async () => {
    h.rpcResult = { data: null, error: { message: 'successor book: this book is promised to a successor, so cancel the handover before closing it' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('successor_planned')
  })
})
