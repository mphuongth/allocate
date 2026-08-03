import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// A holding cannot become a fund purchase while a withdrawal that is not keyed by
// a fund draws on it (#606, supabase/migrations/20260803000003). That refusal
// reaches this route as an ordinary database error, and the route used to map
// everything it didn't recognise to 404 'Transaction not found' — describing a
// refused edit as a missing row, on a holding the user is looking at.
//
// Same contract the POST route already keeps for the withdrawal family: one match
// on the 'withdrawal invariant:' prefix, so a refusal added later cannot fall
// through as the wrong status.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { data: { deposit_group_id: null, asset_type: 'bank' } as unknown, error: null as unknown },
  fund: { data: { id: 'f1' } as unknown, error: null as unknown },
  updateResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      update: () => { op = 'update'; return c },
      eq: () => c,
      single: async () => {
        if (op === 'update') return h.updateResult
        if (table === 'funds') return h.fund
        if (table === 'savings_goals') return { data: { goal_id: 'g1' }, error: null }
        return h.existing
      },
      maybeSingle: async () => h.existing,
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
      rpc: () => ({ single: async () => ({ data: null, error: { message: 'not used' } }) }),
    }),
  }
})

const { PUT } = await import('../[id]/route')

const TX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FUND = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

const call = (body: Record<string, unknown>) =>
  PUT(
    new NextRequest(`https://app.test/api/v1/investment-transactions/${TX}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: TX }) },
  )

const TO_FUND = { asset_type: 'fund', fund_id: FUND, units: 50, unit_price: 40_000 }

describe('PUT /api/v1/investment-transactions/[id] — the withdrawal invariant (#606)', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.existing = { data: { deposit_group_id: null, asset_type: 'bank' }, error: null }
    h.fund = { data: { id: 'f1' }, error: null }
    h.updateResult = { data: { transaction_id: TX }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('converts a plain holding when nothing draws on it', async () => {
    const res = await call(TO_FUND)
    expect(res.status).toBe(200)
  })

  it('answers 400, not 404, when the conversion is refused by the invariant', async () => {
    h.updateResult = {
      data: null,
      error: {
        code: '23514',
        message: 'withdrawal invariant: holding abc cannot become a fund purchase while a withdrawal that is not keyed by a fund draws on it',
      },
    }
    const res = await call(TO_FUND)
    expect(res.status).toBe(400)
    const body = await res.json()
    // The user is told what to do about it, not shown the raw refusal.
    expect(body.error).not.toMatch(/^withdrawal invariant: /)
    expect(body.error).toMatch(/withdrawal/i)
  })

  // One match on the family prefix, so a refusal written later cannot regress to
  // 'Transaction not found' the way listing messages individually allowed.
  it('maps any invariant refusal the same way', async () => {
    h.updateResult = {
      data: null,
      error: { code: '23514', message: 'withdrawal invariant: something nobody has written yet' },
    }
    expect((await call(TO_FUND)).status).toBe(400)
  })

  it('still answers 404 for a genuinely missing row', async () => {
    h.updateResult = { data: null, error: { code: 'PGRST116', message: 'No rows found' } }
    const res = await call(TO_FUND)
    expect(res.status).toBe(404)
  })
})
