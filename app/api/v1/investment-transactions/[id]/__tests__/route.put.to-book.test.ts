import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Editing a term deposit and choosing "Tích luỹ" makes it an accumulating book:
// the row self-groups (deposit_group_id = its own id), so the recurring linked
// to it tops it up instead of opening a new deposit every month. Before this,
// the form sent nothing and the route read nothing — the save reported success
// and the deposit stayed a term deposit.

const TX_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'
const FUND_ID = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { deposit_group_id: null as string | null, asset_type: 'bank' as string | null, transaction_type: 'investment' as string, renewed_from_transaction_id: null as string | null, held_for_merge: false },
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
  h.existing = { deposit_group_id: null, asset_type: 'bank', transaction_type: 'investment', renewed_from_transaction_id: null, held_for_merge: false }
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

describe('PUT /api/v1/investment-transactions/[id] — a term deposit becomes a book', () => {
  const EDIT = { asset_type: 'bank', amount_vnd: 55_059_065, interest_rate: 9.1, expiry_date: '2027-03-03' }

  it('self-groups the deposit, so it is a book from now on', async () => {
    const res = await put({ ...EDIT, accumulating: true })
    expect(res.status).toBe(200)
    expect(h.updates).toMatchObject({ deposit_group_id: TX_ID })
  })

  it('drops the target fund — a book is settled by the book flows', async () => {
    await put({ ...EDIT, accumulating: true })
    expect(h.updates).toMatchObject({ target_fund_id: null })
  })

  it('keeps the lock window the user gave', async () => {
    await put({ ...EDIT, accumulating: true, top_up_lock_days: 30 })
    expect(h.updates).toMatchObject({ deposit_group_id: TX_ID, top_up_lock_days: 30 })
  })

  it('leaves a deposit that was not asked to change alone', async () => {
    await put(EDIT)
    expect(h.updates).not.toHaveProperty('deposit_group_id')
  })

  it('edits a book through the book RPC as before', async () => {
    h.existing = { ...h.existing, deposit_group_id: TX_ID }
    expect((await put({ ...EDIT, accumulating: true })).status).toBe(200)
    expect(h.rpcCalls[0].name).toBe('update_deposit_book')
    expect(h.updates).toBeNull()
  })

  it.each([
    ['a gold holding', { asset_type: 'gold' }],
    ['a withdrawal', { transaction_type: 'withdrawal' }],
    ['a closed cycle', { renewed_from_transaction_id: '44444444-4444-4444-8444-444444444444' }],
    ['a deposit waiting to be merged', { held_for_merge: true }],
  ])('refuses %s', async (_l, over) => {
    h.existing = { ...h.existing, ...over }
    const res = await put({ amount_vnd: 1_000_000, accumulating: true })
    expect(res.status).toBe(400)
    expect(h.updates).toBeNull()
  })

  it('refuses an edit that changes the type away from bank at the same time', async () => {
    expect((await put({ asset_type: 'gold', amount_vnd: 1_000_000, units: 1, unit_price: 1_000_000, accumulating: true })).status).toBe(400)
    expect(h.updates).toBeNull()
  })

  it('refuses an accumulating flag that is not a boolean', async () => {
    expect((await put({ ...EDIT, accumulating: 'yes' })).status).toBe(400)
    expect(h.updates).toBeNull()
  })
})
