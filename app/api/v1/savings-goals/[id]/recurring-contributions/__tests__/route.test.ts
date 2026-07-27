import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// This endpoint synthesizes read-only history rows for a goal's recurring
// savings. Three of its five queries — overrides, logged bank deposits and
// fulfillment records — dropped their error and became `?? []` (#532).
//
// Two of those three exist purely to SUPPRESS a synthesized row: a logged
// deposit means the user already recorded the real transfer, and a fulfillment
// means the amount was folded into a renewed/topped-up deposit's principal.
// Losing either doesn't hide history, it *duplicates* it — the goal's History
// tab shows the same contribution twice. Losing overrides computes the wrong
// amount. All three returned HTTP 200.
//
// Plan months are pinned in the past (2026-01) so `isPlanMonthRealized` stays
// true as the calendar moves.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

vi.mock('@/lib/supabase-server', () => {
  const get = (table: string) => h.results[table] ?? { data: [], error: null }
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      then: (resolve: (v: unknown) => void) => resolve(get(table)),
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

const GOAL_ID = '33333333-3333-4333-8333-333333333333'
const PLAN_ID = '44444444-4444-4444-8444-444444444444'
const SAVING_ID = '55555555-5555-4555-8555-555555555555'
const AMOUNT = 5_000_000

const call = (id: string = GOAL_ID) =>
  GET(new Request(`https://app.test/api/v1/savings-goals/${id}/recurring-contributions`) as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  })

function seedHappyPath() {
  h.results.recurring_savings = {
    data: [{
      saving_id: SAVING_ID,
      goal_id: GOAL_ID,
      name: 'Monthly transfer',
      amount_vnd: AMOUNT,
      effective_from: null,
      effective_to: null,
    }],
    error: null,
  }
  h.results.monthly_plans = { data: [{ id: PLAN_ID, month: 1, year: 2026 }], error: null }
  h.results.recurring_saving_overrides = { data: [], error: null }
  h.results.investment_transactions = { data: [], error: null }
  h.results.recurring_saving_fulfillments = { data: [], error: null }
}

describe('GET /api/v1/savings-goals/[id]/recurring-contributions', () => {
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
    expect((await call()).status).toBe(401)
  })

  it('returns 400 for a malformed goal id', async () => {
    expect((await call('not-a-uuid')).status).toBe(400)
  })

  it('synthesizes a contribution for a realized plan month', async () => {
    seedHappyPath()
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.contributions).toHaveLength(1)
    expect(body.contributions[0].amount_vnd).toBe(AMOUNT)
    expect(body.contributions[0].is_recurring).toBe(true)
  })

  it('returns an empty list for a goal with no recurring savings', async () => {
    seedHappyPath()
    h.results.recurring_savings = { data: [], error: null }
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ contributions: [] })
  })

  it('applies an override amount', async () => {
    seedHappyPath()
    h.results.recurring_saving_overrides = {
      data: [{ plan_id: PLAN_ID, recurring_saving_id: SAVING_ID, monthly_amount_override_vnd: 1_000_000 }],
      error: null,
    }
    const body = await (await call()).json()
    expect(body.contributions[0].amount_vnd).toBe(1_000_000)
  })

  it('suppresses the synthesized row when the real deposit was logged', async () => {
    seedHappyPath()
    h.results.investment_transactions = {
      data: [{ goal_id: GOAL_ID, amount_vnd: AMOUNT, investment_date: '2026-01-15' }],
      error: null,
    }
    const body = await (await call()).json()
    expect(body.contributions).toHaveLength(0)
  })

  it('suppresses the synthesized row when the month was already fulfilled', async () => {
    seedHappyPath()
    h.results.recurring_saving_fulfillments = {
      data: [{ recurring_saving_id: SAVING_ID, ym: '2026-01' }],
      error: null,
    }
    const body = await (await call()).json()
    expect(body.contributions).toHaveLength(0)
  })

  it('fails closed with 500 when the savings read errors', async () => {
    seedHappyPath()
    h.results.recurring_savings = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the overrides read errors', async () => {
    seedHappyPath()
    h.results.recurring_saving_overrides = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the logged-deposits read errors', async () => {
    seedHappyPath()
    h.results.investment_transactions = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the fulfillments read errors', async () => {
    seedHappyPath()
    h.results.recurring_saving_fulfillments = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  // The precise regression: the deposit exists and should suppress the row, but
  // the read failed. The pre-fix code emitted the synthesized row anyway, so the
  // History tab showed the logged deposit AND its synthesized twin.
  it('never emits a duplicate contribution when a suppressing read failed', async () => {
    seedHappyPath()
    h.results.investment_transactions = { data: null, error: { message: 'timeout' } }
    const body = await (await call()).json()
    expect(body.contributions).toBeUndefined()
  })

  // Failing closed must not over-reach. realizedRecurringContributions iterates
  // plans × savings, so with either side empty the answer is definitively [] —
  // no reconciliation source can change it. 500-ing on those reads would refuse
  // a request whose correct answer is already known.
  it('returns an empty list for a goal with no plans, even if a reconciliation read errors', async () => {
    seedHappyPath()
    h.results.monthly_plans = { data: [], error: null }
    h.results.recurring_saving_fulfillments = { data: null, error: { message: 'timeout' } }
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ contributions: [] })
  })

  it('returns an empty list for a goal with no savings, even if a reconciliation read errors', async () => {
    seedHappyPath()
    h.results.recurring_savings = { data: [], error: null }
    h.results.investment_transactions = { data: null, error: { message: 'timeout' } }
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ contributions: [] })
  })

  it('does not leak the database message to the client', async () => {
    seedHappyPath()
    h.results.recurring_saving_fulfillments = {
      data: null,
      error: { message: 'relation "recurring_saving_fulfillments" does not exist' },
    }
    const res = await call()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
