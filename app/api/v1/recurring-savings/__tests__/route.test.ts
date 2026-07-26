import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// When a month is requested, the GET flags each recurring saving as already
// settled for that month via recurring_saving_fulfillments. That second query
// dropped its error, so a failed read marked *every* saving unfulfilled (#533).
//
// That is the dangerous direction: the maturity "combine" picker uses this flag
// to avoid re-folding a recurring that has already been folded into a renewed
// deposit. Reporting a fulfilled saving as unfulfilled offers it for folding a
// second time — the exact double-count the flag exists to prevent. A read
// failure must fail closed, not degrade into the unsafe default.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      then: (resolve: (v: unknown) => void) =>
        resolve(h.results[table] ?? { data: [], error: null }),
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

const { GET } = await import('../route')

const SAVING = {
  saving_id: 'saving-1',
  name: 'Monthly deposit',
  goal_id: 'goal-1',
  amount_vnd: 5_000_000,
  effective_from: null,
  effective_to: null,
  linked_deposit_tx_id: null,
  savings_goals: { goal_name: 'House' },
}

const req = (query = '') =>
  new Request(`https://app.test/api/v1/recurring-savings${query}`) as unknown as NextRequest

describe('GET /api/v1/recurring-savings', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.results = {}
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns the savings when no month is requested', async () => {
    h.results.recurring_savings = { data: [SAVING], error: null }
    const res = await GET(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ savings: [SAVING] })
  })

  it('returns an empty list for a user with no recurring savings', async () => {
    h.results.recurring_savings = { data: [], error: null }
    const res = await GET(req('?month=6&year=2026'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ savings: [] })
  })

  it('flags a saving already fulfilled for the requested month', async () => {
    h.results.recurring_savings = { data: [SAVING], error: null }
    h.results.recurring_saving_fulfillments = {
      data: [{ recurring_saving_id: 'saving-1' }],
      error: null,
    }
    const res = await GET(req('?month=6&year=2026'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.savings[0].fulfilled).toBe(true)
  })

  it('leaves a saving unfulfilled when no fulfillment row exists', async () => {
    h.results.recurring_savings = { data: [SAVING], error: null }
    h.results.recurring_saving_fulfillments = { data: [], error: null }
    const res = await GET(req('?month=6&year=2026'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.savings[0].fulfilled).toBe(false)
  })

  it('fails closed with 500 when the fulfillment read errors', async () => {
    h.results.recurring_savings = { data: [SAVING], error: null }
    h.results.recurring_saving_fulfillments = { data: null, error: { message: 'timeout' } }
    const res = await GET(req('?month=6&year=2026'))
    expect(res.status).toBe(500)
  })

  it('never reports a saving as unfulfilled when the fulfillment read failed', async () => {
    h.results.recurring_savings = { data: [SAVING], error: null }
    h.results.recurring_saving_fulfillments = { data: null, error: { message: 'timeout' } }
    const res = await GET(req('?month=6&year=2026'))
    const body = await res.json()
    expect(body.savings).toBeUndefined()
  })

  it('fails closed with 500 when the savings read errors', async () => {
    h.results.recurring_savings = { data: null, error: { message: 'timeout' } }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
