import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The remaining-balance invariant lives in the database — one trigger for every
// writer, measuring under a lock so two concurrent sells can't both pass (#587,
// supabase/migrations/20260730000002). This file covers the route's half of that
// contract: a refusal has to reach the user as a 400 that says what happened, not
// the generic 500 every insert failure used to collapse into.
//
// Same shape as the book withdrawal already does (withdraw-book maps 'more than
// the book balance' to 'Withdrawal exceeds the book balance.'), so the two sell
// paths answer alike.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  ref: { data: { transaction_id: 'src-1', deposit_group_id: null } as unknown, error: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      insert: () => { op = 'insert'; return c },
      update: () => { op = 'update'; return c },
      eq: () => c, is: () => c, not: () => c,
      single: async () => (op === 'insert' ? h.insertResult : h.ref),
      maybeSingle: async () => (op === 'insert' ? h.insertResult : h.ref),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    }
    void table
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
    }),
  }
})

const { POST } = await import('../route')

const SOURCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const SELL = {
  transaction_type: 'withdrawal',
  asset_type: 'bank',
  investment_date: '2026-07-01',
  amount_vnd: 50_000_000,
  parent_transaction_id: SOURCE,
  principal_withdrawn: 50_000_000,
}

const call = (body: Record<string, unknown> = SELL) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

// What the trigger raises; supabase-js surfaces the SQLSTATE as `code`.
const balanceRefusal = (message: string) => ({
  data: null,
  error: { code: '23514', message },
})

describe('POST /api/v1/investment-transactions — remaining balance', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.ref = { data: { transaction_id: SOURCE, deposit_group_id: null }, error: null }
    h.insertResult = { data: { transaction_id: 'new-1' }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('creates the withdrawal when the holding covers it', async () => {
    const res = await call()
    expect(res.status).toBe(201)
  })

  it('answers 400 with the reason when the principal exceeds the balance', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal of 50000000 exceeds the remaining balance of 40000000 on this holding')

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Withdrawal exceeds the remaining balance of this holding.' })
  })

  it('answers 400 for a unit overdraw too', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal of 5 units exceeds the remaining balance of 4 units on this holding')

    const res = await call({ ...SELL, asset_type: 'gold', units_withdrawn: 5 })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/remaining balance/i) })
  })

  // A stale tab and a lost race look identical from here: the balance moved after
  // the sheet read it. Telling the user the balance is gone is the useful answer,
  // and it must not be a 500 — nothing failed.
  it('does not report a balance refusal as a server error', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal of 1 exceeds the remaining balance of 0 on this holding')

    const res = await call()

    expect(res.status).not.toBe(500)
  })

  // The trigger's other refusal: principal taken out of a row attached to no
  // holding, which subtracts from nothing while claiming cash left.
  it('answers 400 when the withdrawal draws on no holding', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal draws on no holding: it has neither a parent transaction nor a fund')

    const res = await call({ ...SELL, parent_transaction_id: undefined })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'A withdrawal must be attached to a holding.' })
  })

  it('still reports an unrelated insert failure as a 500', async () => {
    h.insertResult = { data: null, error: { code: '08006', message: 'connection failure' } }

    const res = await call()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to create transaction' })
  })

  // A different check_violation (an ownership trigger, say) is not a balance
  // problem and must keep its own answer rather than borrowing this message.
  it('does not claim a balance problem for other constraint failures', async () => {
    h.insertResult = balanceRefusal('parent_transaction_id does not belong to the row owner')

    const res = await call()

    expect(res.status).toBe(500)
  })
})
