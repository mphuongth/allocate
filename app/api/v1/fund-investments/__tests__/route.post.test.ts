import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// POST /fund-investments is the legacy create path. It validated fund_id and
// goal_id as UUIDs and stopped there (#586) — but a well-formed UUID is not
// proof of ownership, and neither column is protected by a physical FK to the
// caller. A known foreign id therefore linked the caller's holding to someone
// else's fund or goal, exactly the hole the canonical route closed in #474.
//
// Ownership is checked here the same way it is there: a scoped lookup, 403 when
// it comes back empty, and nothing written.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  fund: { data: { id: 'fund' } as unknown, error: null as unknown },
  goal: { data: { goal_id: 'goal' } as unknown, error: null as unknown },
  plan: { data: { id: 'plan' } as unknown, error: null as unknown },
  inserted: { data: null as unknown, error: null as unknown },
  insert: null as unknown,
  lookups: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      insert: (payload: unknown) => { h.insert = payload; op = 'insert'; return c },
      eq: () => c,
      single: async () => resolve(),
      maybeSingle: async () => resolve(),
    }
    const resolve = () => {
      if (op === 'insert') return h.inserted
      h.lookups.push(table)
      if (table === 'funds') return h.fund
      if (table === 'savings_goals') return h.goal
      return h.plan
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
    }),
  }
})

const { POST } = await import('../route')

const FUND = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const GOAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TX = '11111111-1111-4111-8111-111111111111'

const body = (over: Record<string, unknown> = {}) => ({
  fund_id: FUND, amount_vnd: 2_000_000, units_purchased: 100,
  nav_at_purchase: 20_000, investment_date: '2026-01-01', ...over,
})

const call = (b: unknown) =>
  POST(new NextRequest('https://app.test/api/v1/fund-investments', {
    method: 'POST', body: JSON.stringify(b),
  }))

describe('POST /api/v1/fund-investments', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.fund = { data: { id: FUND }, error: null }
    h.goal = { data: { goal_id: GOAL }, error: null }
    h.plan = { data: { id: 'plan-1' }, error: null }
    h.inserted = {
      data: {
        transaction_id: TX, fund_id: FUND, goal_id: GOAL, amount_vnd: 2_000_000,
        units: 100, unit_price: 20_000, investment_date: '2026-01-01', created_at: 'now',
      },
      error: null,
    }
    h.insert = null
    h.lookups = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('creates a fund investment the caller owns', async () => {
    const res = await call(body({ goal_id: GOAL }))

    expect(res.status).toBe(201)
    expect(h.insert).toMatchObject({ user_id: 'user-1', fund_id: FUND, goal_id: GOAL, asset_type: 'fund' })
  })

  it('rejects a fund the caller does not own', async () => {
    h.fund = { data: null, error: null }

    const res = await call(body())

    expect(res.status).toBe(403)
    expect(h.insert).toBeNull()
  })

  it('rejects a goal the caller does not own', async () => {
    h.goal = { data: null, error: null }

    const res = await call(body({ goal_id: GOAL }))

    expect(res.status).toBe(403)
    expect(h.insert).toBeNull()
  })

  it('does not look up a goal when none was given', async () => {
    await call(body())

    expect(h.lookups).not.toContain('savings_goals')
  })
})
