import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Changing a transaction's asset type used to leave the previous subtype's
// columns behind (#593): Bank -> Fund/Gold kept the rate, maturity and bank
// code; Gold -> Bank kept the units and unit price. The row then described two
// kinds of holding at once, and every later reader — valuation, reports,
// migrations — had to guess which half was true.
//
// The edit route is the one place every type change passes through, so it is
// where the old subtype is cleared.

const TX_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'
const FUND_ID = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { deposit_group_id: null as string | null, asset_type: 'bank' as string | null },
  updates: null as Record<string, unknown> | null,
  updateResult: { data: { transaction_id: '11111111-1111-4111-8111-111111111111' } as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: { data: { transaction_id: '11111111-1111-4111-8111-111111111111' } as unknown, error: null as unknown },
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

/** The columns that belong to exactly one asset type. */
const EXCLUSIVE = [
  'fund_id', 'units', 'unit_price',
  'interest_rate', 'expiry_date', 'bank_code', 'interest_earned_vnd', 'deposit_group_id',
] as const

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.existing = { deposit_group_id: null, asset_type: 'bank' }
  h.updates = null
  h.updateResult = { data: { transaction_id: TX_ID }, error: null }
  h.rpcCalls = []
  h.rpcResult = { data: { transaction_id: TX_ID }, error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/v1/investment-transactions/[id] — subtype normalization (#593)', () => {
  it('clears the bank metadata when a deposit becomes a fund', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'bank' }
    const res = await put({
      asset_type: 'fund', fund_id: FUND_ID, amount_vnd: 5_000_000,
      units: 250, unit_price: 20_000,
    })
    expect(res.status).toBe(200)
    expect(h.updates).toMatchObject({
      asset_type: 'fund', fund_id: FUND_ID, units: 250, unit_price: 20_000,
      interest_rate: null, expiry_date: null, bank_code: null,
      interest_earned_vnd: null, deposit_group_id: null,
    })
  })

  it('clears the bank metadata when a deposit becomes gold', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'bank' }
    await put({ asset_type: 'gold', amount_vnd: 7_000_000, units: 2, unit_price: 3_500_000 })
    expect(h.updates).toMatchObject({
      asset_type: 'gold', fund_id: null, units: 2, unit_price: 3_500_000,
      interest_rate: null, expiry_date: null, bank_code: null,
      interest_earned_vnd: null, deposit_group_id: null,
    })
  })

  it('clears the units and unit price when gold becomes a bank deposit', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'gold' }
    await put({ asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 5.5, expiry_date: '2027-01-01' })
    expect(h.updates).toMatchObject({
      asset_type: 'bank', units: null, unit_price: null, fund_id: null,
      interest_rate: 5.5, expiry_date: '2027-01-01',
    })
  })

  it('clears the fund link and stale units when a fund becomes a bank deposit', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'fund' }
    await put({ asset_type: 'bank', amount_vnd: 10_000_000 })
    expect(h.updates).toMatchObject({ asset_type: 'bank', fund_id: null, units: null, unit_price: null })
  })

  it('clears the stale gold units when gold becomes a fund and the caller omits them', async () => {
    // Gold units are chỉ and fund units are shares — carrying them over would
    // value the fund holding off the gold quantity.
    h.existing = { deposit_group_id: null, asset_type: 'gold' }
    await put({ asset_type: 'fund', fund_id: FUND_ID, amount_vnd: 5_000_000 })
    expect(h.updates).toMatchObject({ asset_type: 'fund', fund_id: FUND_ID, units: null, unit_price: null })
  })

  // Both directions of every transition: nothing exclusive to the old type may
  // survive, whether or not the caller sent a replacement for it.
  const TYPES = ['fund', 'bank', 'gold'] as const
  for (const from of TYPES) {
    for (const to of TYPES) {
      if (from === to) continue
      it(`leaves no ${from} field set after a change to ${to}`, async () => {
        h.existing = { deposit_group_id: null, asset_type: from }
        await put({ asset_type: to, ...(to === 'fund' ? { fund_id: FUND_ID } : {}), amount_vnd: 1_000_000 })
        const updates = h.updates ?? {}
        for (const field of EXCLUSIVE) {
          expect(updates).toHaveProperty(field)
          if (to === 'fund' && field === 'fund_id') expect(updates[field]).toBe(FUND_ID)
          else expect(updates[field]).toBeNull()
        }
      })
    }
  }

  it('leaves the subtype fields alone on a partial edit that keeps the type', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'bank' }
    await put({ notes: 'renamed' })
    const updates = h.updates ?? {}
    for (const field of EXCLUSIVE) expect(updates).not.toHaveProperty(field)
    expect(updates).toMatchObject({ notes: 'renamed' })
  })

  it('leaves the subtype fields alone when the edit restates the same type', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'bank' }
    await put({ asset_type: 'bank', amount_vnd: 2_000_000 })
    const updates = h.updates ?? {}
    for (const field of EXCLUSIVE) expect(updates).not.toHaveProperty(field)
    expect(updates).toMatchObject({ asset_type: 'bank', amount_vnd: 2_000_000 })
  })

  it('still scopes a stray bank_code to bank deposits on a same-type edit', async () => {
    h.existing = { deposit_group_id: null, asset_type: 'fund' }
    await put({ bank_code: 'VCB' })
    expect(h.updates).toMatchObject({ bank_code: null })
  })

  it('refuses to change the asset type of an accumulating deposit book', async () => {
    // A book is a group of bank tranches; converting one row would leave the
    // rest of the group describing a deposit that no longer exists.
    h.existing = { deposit_group_id: 'book-1', asset_type: 'bank' }
    const res = await put({ asset_type: 'gold', amount_vnd: 1_000_000 })
    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.updates).toBeNull()
  })

  it('still edits an accumulating book through the atomic RPC when the type is unchanged', async () => {
    h.existing = { deposit_group_id: 'book-1', asset_type: 'bank' }
    const res = await put({ asset_type: 'bank', amount_vnd: 1_000_000 })
    expect(res.status).toBe(200)
    expect(h.rpcCalls.map((c) => c.name)).toEqual(['update_deposit_book'])
  })

  it('reports a book the database refused to convert as a conflict, not a missing row', async () => {
    // The route's own guard reads deposit_group_id before it writes, so a
    // deposit that becomes a book in between (a recurring top-up self-groups its
    // anchor) is refused by the trigger instead. 404 would describe that as a
    // row that isn't there.
    h.existing = { deposit_group_id: null, asset_type: 'bank' }
    h.updateResult = {
      data: null,
      error: { message: 'deposit book: a tranche of an accumulating book cannot change asset type' },
    }
    const res = await put({ asset_type: 'gold', amount_vnd: 1_000_000 })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'book_type_change' })
  })

  // A book tranche takes the RPC path, which returns before the plain-update
  // branch's `withdrawal invariant:` mapping ever runs. Left to the generic
  // handler, shrinking a tranche below what has been withdrawn from it (#608)
  // answered 500 — the app looking broken — while the identical conflict on an
  // ordinary deposit answered 400 with something the user can act on.
  it('maps the withdrawal invariant to a 400 on the book path too', async () => {
    h.existing = { deposit_group_id: 'book-1', asset_type: 'bank' }
    h.rpcResult = {
      data: null,
      error: { message: 'withdrawal invariant: holding abc would be left owing 30000000 it does not hold' },
    }

    const res = await put({ amount_vnd: 1_000_000 })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'withdrawal_invariant' })
  })

  it('still reports an unrecognised book failure as a server error', async () => {
    h.existing = { deposit_group_id: 'book-1', asset_type: 'bank' }
    h.rpcResult = { data: null, error: { message: 'deadlock detected' } }

    const res = await put({ amount_vnd: 1_000_000 })

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('deadlock')
  })

  it('does not normalize a legacy row whose asset type is unknown', async () => {
    h.existing = { deposit_group_id: null, asset_type: null }
    await put({ asset_type: 'fund', fund_id: FUND_ID, amount_vnd: 1_000_000 })
    const updates = h.updates ?? {}
    expect(updates).toMatchObject({ asset_type: 'fund', fund_id: FUND_ID })
    expect(updates).not.toHaveProperty('interest_rate')
  })
})
