import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Parking a month's fund DCA in a term deposit is one database call
// (park_dca_in_deposit, 20261002000002): the deposit, the dropped seed and the
// skip that names the deposit land together. The route validates and maps the
// function's refusals to answers the plan page can show.

const PLAN = '11111111-1111-4111-8111-111111111111'
const FUND = '33333333-3333-4333-8333-333333333333'
const FUND2 = '44444444-4444-4444-8444-444444444444'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => { h.calls.push({ name, args }); return h.result },
  }),
}))

const { POST } = await import('../route')

const call = (body: Record<string, unknown>, id = PLAN) =>
  POST(new NextRequest(`https://app.test/api/v1/monthly-plans/${id}/dca-skips/park`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) })

const BODY = {
  fund_id: FUND, amount_vnd: 5_000_000, interest_rate: 6.5,
  investment_date: '2026-10-02', expiry_date: '2027-04-02', bank_code: 'VCB', notes: 'Vietcombank',
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.calls = []
  h.result = { data: 'dep-1', error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/v1/monthly-plans/[id]/dca-skips/park', () => {
  it('rejects an unauthenticated request', async () => {
    h.user = null
    expect((await call(BODY)).status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })

  it('parks the DCA in one call and returns the deposit', async () => {
    const res = await call(BODY)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ deposit_id: 'dep-1' })
    expect(h.calls).toEqual([{ name: 'park_dca_lines_in_deposit', args: {
      p_plan_id: PLAN, p_fund_ids: [FUND], p_amount_vnd: 5_000_000, p_interest_rate: 6.5,
      p_investment_date: '2026-10-02', p_expiry_date: '2027-04-02', p_bank_code: 'VCB', p_notes: 'Vietcombank',
    } }])
  })

  // Several DCA lines of one goal parked in one real deposit (20261003000002).
  it('parks several DCA lines in one deposit', async () => {
    const res = await call({ ...BODY, fund_id: undefined, fund_ids: [FUND, FUND2] })
    expect(res.status).toBe(201)
    expect(h.calls[0]).toMatchObject({ name: 'park_dca_lines_in_deposit', args: { p_fund_ids: [FUND, FUND2] } })
  })

  it.each([
    ['an empty list', { fund_id: undefined, fund_ids: [] }],
    ['a malformed id in the list', { fund_id: undefined, fund_ids: [FUND, 'nope'] }],
    ['a fund named twice', { fund_id: undefined, fund_ids: [FUND, FUND] }],
    ['a list that is not an array', { fund_id: undefined, fund_ids: FUND }],
  ])('refuses %s without calling the database', async (_l, over) => {
    expect((await call({ ...BODY, ...over })).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('sends no bank or note when none is given', async () => {
    await call({ ...BODY, bank_code: '', notes: undefined })
    expect(h.calls[0].args).toMatchObject({ p_bank_code: null, p_notes: null })
  })

  it.each([
    ['a malformed fund', { fund_id: 'nope' }],
    ['no amount', { amount_vnd: 0 }],
    ['no rate', { interest_rate: null }],
    ['a malformed date', { investment_date: '02/10/2026' }],
    ['no maturity', { expiry_date: null }],
  ])('refuses %s without calling the database', async (_l, over) => {
    expect((await call({ ...BODY, ...over })).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it("states the function's own rule as a 400", async () => {
    h.result = { data: null, error: { code: '23514', message: "park dca: this month's DCA for the fund is already bought" } }
    const res = await call(BODY)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: "this month's DCA for the fund is already bought", code: 'park_refused' })
  })

  it("answers someone else's fund with 403 and a missing plan with 404", async () => {
    h.result = { data: null, error: { code: '42501', message: "park dca: the fund does not belong to this plan's owner" } }
    expect((await call(BODY)).status).toBe(403)
    h.result = { data: null, error: { code: 'P0002', message: 'park dca: the plan was not found' } }
    expect((await call(BODY)).status).toBe(404)
  })

  it('answers a finished goal with 409 and anything else as a fault', async () => {
    h.result = { data: null, error: { code: '23514', message: 'completed goal: this goal is finished' } }
    expect((await call(BODY)).status).toBe(409)
    h.result = { data: null, error: { code: 'XX000', message: 'connection reset' } }
    expect((await call(BODY)).status).toBe(500)
  })
})
