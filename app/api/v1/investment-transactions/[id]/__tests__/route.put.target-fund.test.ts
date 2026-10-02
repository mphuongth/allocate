import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Editing a deposit sets or clears the fund it moves to at maturity
// (20261001000001). Only a single bank deposit carries one: a book is edited
// through update_deposit_book, which has no such field, and a fund or gold row
// is not a deposit. A type change away from bank drops it with the rest of the
// bank subtype.

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
  ownsFund: true,
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
        if (table === 'funds') return { data: h.ownsFund ? { id: FUND_ID } : null, error: null }
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
  h.existing = { deposit_group_id: null, asset_type: 'bank' }
  h.updates = null
  h.updateResult = { data: { transaction_id: TX_ID }, error: null }
  h.rpcResult = { data: { transaction_id: TX_ID }, error: null }
  h.rpcCalls = []
  h.ownsFund = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/v1/investment-transactions/[id] — target fund', () => {
  it('sets the target fund on a deposit', async () => {
    const res = await put({ asset_type: 'bank', amount_vnd: 5_000_000, target_fund_id: FUND_ID })
    expect(res.status).toBe(200)
    expect(h.updates).toMatchObject({ target_fund_id: FUND_ID })
  })

  it('clears it on null', async () => {
    await put({ asset_type: 'bank', amount_vnd: 5_000_000, target_fund_id: null })
    expect(h.updates).toMatchObject({ target_fund_id: null })
  })

  it('leaves it alone when the edit does not mention it', async () => {
    await put({ asset_type: 'bank', amount_vnd: 5_000_000 })
    expect(h.updates).not.toHaveProperty('target_fund_id')
  })

  it("refuses another user's fund", async () => {
    h.ownsFund = false
    const res = await put({ asset_type: 'bank', amount_vnd: 5_000_000, target_fund_id: FUND_ID })
    expect(res.status).toBe(403)
    expect(h.updates).toBeNull()
  })

  it('drops the target fund when the deposit becomes a fund', async () => {
    await put({ asset_type: 'fund', fund_id: FUND_ID, amount_vnd: 5_000_000, units: 250, unit_price: 20_000 })
    expect(h.updates).toMatchObject({ asset_type: 'fund', target_fund_id: null })
  })

  it('refuses a target fund on a row that is not a bank deposit', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'gold' }
    const res = await put({ amount_vnd: 5_000_000, target_fund_id: FUND_ID })
    expect(res.status).toBe(400)
    expect(h.updates).toBeNull()
  })

  it('refuses a target fund on a book, and edits a book normally without one', async () => {
    h.existing = { deposit_group_id: TX_ID, asset_type: 'bank' }
    expect((await put({ amount_vnd: 5_000_000, target_fund_id: FUND_ID })).status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)

    expect((await put({ amount_vnd: 5_000_000, target_fund_id: null })).status).toBe(200)
    expect(h.rpcCalls[0].name).toBe('update_deposit_book')
  })
})
