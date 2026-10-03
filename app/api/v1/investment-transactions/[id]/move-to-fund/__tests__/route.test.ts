import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Moving a matured term deposit into its target fund is one database call
// (move_deposit_to_fund, 20261001000001): the deposit is closed and the fund
// bought with the same money, in the same goal, in one transaction. The route
// validates the request and turns the function's refusals into answers the
// sheet can show — a rule the user can act on is never a 500.

const DEP = '11111111-1111-4111-8111-111111111111'
const FUND = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  calls: [] as { name: string; args: Record<string, unknown> }[],
  result: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.calls.push({ name, args })
      return h.result
    },
  }),
}))

const { POST } = await import('../route')

const call = (body: Record<string, unknown>, id = DEP) =>
  POST(new NextRequest(`https://app.test/api/v1/investment-transactions/${id}/move-to-fund`, {
    method: 'POST', body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) })

const BODY = { received_vnd: 102_991_781, fund_id: FUND, units: 4119.67, unit_price: 25_000, date: '2026-04-01' }

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.calls = []
  h.result = { data: { withdrawal_id: 'wd-1', purchase_id: 'buy-1' }, error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/v1/investment-transactions/[id]/move-to-fund', () => {
  it('rejects an unauthenticated request', async () => {
    h.user = null
    expect((await call(BODY)).status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })

  it('moves the deposit in one call, with the payout, fund, units, NAV and date', async () => {
    const res = await call(BODY)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ withdrawal_id: 'wd-1', purchase_id: 'buy-1' })
    expect(h.calls).toEqual([{ name: 'move_deposit_to_fund', args: {
      p_deposit_id: DEP, p_received_vnd: 102_991_781, p_fund_id: FUND,
      p_units: 4119.67, p_unit_price: 25_000, p_date: '2026-04-01',
    } }])
  })

  it('lets the database date it today when no date is given', async () => {
    await call({ ...BODY, date: undefined })
    expect(h.calls[0].args.p_date).toBeNull()
  })

  it('sends whole đồng', async () => {
    await call({ ...BODY, received_vnd: 102_991_781.4 })
    expect(h.calls[0].args.p_received_vnd).toBe(102_991_781)
  })

  it.each([
    ['a non-positive payout', { received_vnd: 0 }],
    ['no units', { units: 0 }],
    ['no NAV', { unit_price: null }],
    ['a malformed fund', { fund_id: 'nope' }],
    ['a malformed date', { date: '01/04/2026' }],
  ])('refuses %s without calling the database', async (_label, over) => {
    expect((await call({ ...BODY, ...over })).status).toBe(400)
    expect(h.calls).toHaveLength(0)
  })

  it('refuses a malformed deposit id', async () => {
    expect((await call(BODY, 'nope')).status).toBe(400)
  })

  it("states the function's own rule as a 400 the user can act on", async () => {
    h.result = { data: null, error: { code: '23514', message: 'move to fund: the deposit has not matured yet' } }
    const res = await call(BODY)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'the deposit has not matured yet', code: 'move_refused' })
  })

  it("answers someone else's fund with 403", async () => {
    h.result = { data: null, error: { code: '42501', message: "move to fund: the fund does not belong to this deposit's owner" } }
    expect((await call(BODY)).status).toBe(403)
  })

  it('answers a deposit that is not there (or not yours) with 404', async () => {
    h.result = { data: null, error: { code: 'P0002', message: 'move to fund: the deposit was not found' } }
    expect((await call(BODY)).status).toBe(404)
  })

  it('answers a finished goal with 409', async () => {
    h.result = { data: null, error: { code: '23514', message: 'completed goal: this goal is finished' } }
    expect((await call(BODY)).status).toBe(409)
  })

  it('reports anything else as a fault', async () => {
    h.result = { data: null, error: { code: 'XX000', message: 'connection reset' } }
    expect((await call(BODY)).status).toBe(500)
  })

  // A deposit that parked several DCA lines goes back into all their funds at
  // once (move_deposit_to_funds, 20261003000003): one call, one pair per fund.
  describe('several funds', () => {
    const FUND2 = '44444444-4444-4444-8444-444444444444'
    const LEGS = [
      { fund_id: FUND, received_vnd: 1_030_000.4, units: 41.2, unit_price: 25_000 },
      { fund_id: FUND2, received_vnd: 1_545_000, units: 77.25, unit_price: 20_000 },
    ]

    it('moves into every fund in one call', async () => {
      h.result = { data: [{ withdrawal_id: 'wd-1', purchase_id: 'buy-1' }, { withdrawal_id: 'wd-2', purchase_id: 'buy-2' }], error: null }
      const res = await call({ legs: LEGS, date: '2026-04-01' })
      expect(res.status).toBe(201)
      expect(await res.json()).toEqual({ moves: [{ withdrawal_id: 'wd-1', purchase_id: 'buy-1' }, { withdrawal_id: 'wd-2', purchase_id: 'buy-2' }] })
      expect(h.calls).toEqual([{ name: 'move_deposit_to_funds', args: {
        p_deposit_id: DEP,
        p_legs: [
          { fund_id: FUND, received_vnd: 1_030_000, units: 41.2, unit_price: 25_000 },
          { fund_id: FUND2, received_vnd: 1_545_000, units: 77.25, unit_price: 20_000 },
        ],
        p_date: '2026-04-01',
      } }])
    })

    it.each([
      ['an empty list', []],
      ['a list that is not an array', 'nope'],
      ['a malformed fund', [{ ...LEGS[0], fund_id: 'nope' }]],
      ['a fund named twice', [LEGS[0], LEGS[0]]],
      ['no payout', [{ ...LEGS[0], received_vnd: 0 }]],
      ['no units', [{ ...LEGS[0], units: 0 }]],
      ['no NAV', [{ ...LEGS[0], unit_price: 0 }]],
    ])('refuses %s without calling the database', async (_l, legs) => {
      expect((await call({ legs })).status).toBe(400)
      expect(h.calls).toHaveLength(0)
    })

    it("states the function's own rule as a 400", async () => {
      h.result = { data: null, error: { code: '23514', message: 'move to fund: the deposit has not matured yet' } }
      const res = await call({ legs: LEGS })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'the deposit has not matured yet', code: 'move_refused' })
    })
  })
})

