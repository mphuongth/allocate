import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// A fund purchase made by moving a matured deposit is priced at the NAV the app
// knew, and flagged units_estimated until the user corrects it to the NAV the
// order filled at (20261001000001). Saving the purchase through the edit form
// IS that correction — the user has looked at it — so it clears the flag. A
// type change away from fund clears it too, or the row would fail the column's
// shape check (an estimate needs priced fund units).

const TX_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'
const FUND_ID = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { deposit_group_id: null as string | null, asset_type: 'bank' as string | null },
  updates: null as Record<string, unknown> | null,
  updateResult: { data: { transaction_id: '11111111-1111-4111-8111-111111111111' } as unknown, error: null as unknown },
  rpcResult: { data: { transaction_id: '11111111-1111-4111-8111-111111111111' } as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase-server', () => {
  function chainFor(table: string) {
    let op: 'select' | 'update' = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      update: (payload: Record<string, unknown>) => { op = 'update'; h.updates = payload; return c },
      single: async () => {
        if (op === 'update') return h.updateResult
        if (table === 'savings_goals') return { data: { goal_id: GOAL_ID }, error: null }
        if (table === 'funds') return { data: { id: FUND_ID }, error: null }
        return { data: h.existing, error: null }
      },
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chainFor(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args })
        return { single: async () => h.rpcResult }
      },
    }),
  }
})

const { PUT } = await import('../route')

const put = (body: Record<string, unknown>) =>
  PUT(
    new Request(`https://app.test/api/v1/investment-transactions/${TX_ID}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: TX_ID }) },
  )

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.existing = { deposit_group_id: null, asset_type: 'fund' }
  h.updates = null
  h.updateResult = { data: { transaction_id: TX_ID }, error: null }
  h.rpcResult = { data: { transaction_id: TX_ID }, error: null }
  h.rpcCalls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/v1/investment-transactions/[id] — estimated units', () => {
  it('clears the estimate when the user saves corrected units and NAV', async () => {
    const res = await put({ asset_type: 'fund', fund_id: FUND_ID, amount_vnd: 102_991_781, units: 4100, unit_price: 25_120 })
    expect(res.status).toBe(200)
    expect(h.updates).toMatchObject({ units: 4100, unit_price: 25_120, units_estimated: false })
  })

  it('clears it when the purchase stops being a fund', async () => {
    await put({ asset_type: 'gold', amount_vnd: 7_000_000, units: 2, unit_price: 3_500_000 })
    expect(h.updates).toMatchObject({ asset_type: 'gold', units_estimated: false })
  })

  it('never sends it to the book RPC, which has no such column', async () => {
    h.existing = { deposit_group_id: TX_ID, asset_type: 'bank' }
    await put({ amount_vnd: 5_000_000 })
    expect(h.rpcCalls[0].args).not.toHaveProperty('p_units_estimated')
  })
})
