import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// The savings history for an insurance member is built from five sources. Only
// the member and the manual-savings queries were error-checked; monthly plans,
// plan exclusions and per-plan overrides were each collapsed to `?? []` (#529).
//
// Every one of them feeds `entries` and `totalSaved`, so a failure silently
// removes real contributions and understates the total behind an HTTP 200 —
// indistinguishable from a member who genuinely has no planning data. And this
// total is supposed to reconcile with the dashboard's "Saved" amount, so a
// partial answer here reads as a discrepancy between two screens rather than as
// the outage it is.
//
// Plan months are fixed in the past (2026-01) so `isPlanMonthRealized` stays
// true as the calendar moves — these tests must not rot.

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
      single: async () => get(table),
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

const MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const PLAN_ID = '22222222-2222-4222-8222-222222222222'

const call = () =>
  GET(new Request(`https://app.test/api/v1/insurance-members/${MEMBER_ID}/savings`) as unknown as NextRequest, {
    params: Promise.resolve({ id: MEMBER_ID }),
  })

// Annual 12,000,000 → default monthly 1,000,000.
const member = { annual_payment_vnd: 12_000_000, user_id: 'user-1', last_payment_date: null }

function seedHappyPath() {
  h.results.insurance_members = { data: member, error: null }
  h.results.insurance_savings = {
    data: [{ id: 'saving-1', amount_saved_vnd: 500_000, saved_date: '2026-01-15', created_at: null }],
    error: null,
  }
  h.results.monthly_plans = { data: [{ id: PLAN_ID, month: 1, year: 2026 }], error: null }
  h.results.plan_excluded_insurance_members = { data: [], error: null }
  h.results.plan_insurance_member_overrides = { data: [], error: null }
}

describe('GET /api/v1/insurance-members/[id]/savings', () => {
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

  it('returns 404 when the member does not exist', async () => {
    h.results.insurance_members = { data: null, error: { message: 'no rows' } }
    expect((await call()).status).toBe(404)
  })

  it('returns 403 when the member belongs to another user', async () => {
    h.results.insurance_members = { data: { ...member, user_id: 'user-2' }, error: null }
    expect((await call()).status).toBe(403)
  })

  it('sums manual savings and realized plan accruals', async () => {
    seedHappyPath()
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.entries).toHaveLength(2)
    expect(body.totalSaved).toBe(1_500_000) // 500k logged + 1M plan accrual
  })

  it('applies a per-plan override instead of the default monthly amount', async () => {
    seedHappyPath()
    h.results.plan_insurance_member_overrides = {
      data: [{ plan_id: PLAN_ID, member_id: MEMBER_ID, monthly_amount_override_vnd: 250_000 }],
      error: null,
    }
    const body = await (await call()).json()
    expect(body.totalSaved).toBe(750_000) // 500k logged + 250k override
  })

  it('skips a plan that excludes this member', async () => {
    seedHappyPath()
    h.results.plan_excluded_insurance_members = {
      data: [{ plan_id: PLAN_ID, member_id: MEMBER_ID }],
      error: null,
    }
    const body = await (await call()).json()
    expect(body.totalSaved).toBe(500_000) // logged only
  })

  it('returns a valid empty history for a member with no savings and no plans', async () => {
    h.results.insurance_members = { data: member, error: null }
    h.results.insurance_savings = { data: [], error: null }
    h.results.monthly_plans = { data: [], error: null }
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ entries: [], totalSaved: 0 })
  })

  it('fails closed with 500 when the manual-savings read errors', async () => {
    seedHappyPath()
    h.results.insurance_savings = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the monthly-plans read errors', async () => {
    seedHappyPath()
    h.results.monthly_plans = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the plan-exclusions read errors', async () => {
    seedHappyPath()
    h.results.plan_excluded_insurance_members = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('fails closed with 500 when the insurance-overrides read errors', async () => {
    seedHappyPath()
    h.results.plan_insurance_member_overrides = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  it('never returns a partial total alongside a 200', async () => {
    seedHappyPath()
    h.results.monthly_plans = { data: null, error: { message: 'timeout' } }
    const res = await call()
    const body = await res.json()
    // The pre-fix behaviour: 200 with only the 500k logged entry, plan accrual lost.
    expect(body.totalSaved).toBeUndefined()
    expect(body.entries).toBeUndefined()
  })

  it('does not leak the database message to the client', async () => {
    seedHappyPath()
    h.results.monthly_plans = { data: null, error: { message: 'relation "monthly_plans" does not exist' } }
    const res = await call()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
