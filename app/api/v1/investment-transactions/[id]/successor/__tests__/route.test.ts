import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Opening the successor of a book that stopped accepting top-ups (#638). The
// route is thin on purpose: everything that has to happen together — the new
// book, the month's contribution, the fulfillment, the moved recurring link —
// happens inside open_successor_book. What the route owes is validation, the
// recurring's ownership, and turning the RPC's refusals into answers a user can
// act on rather than a 500.

const BOOK = '11111111-1111-4111-8111-111111111111'
const NEW_BOOK = '22222222-2222-4222-8222-222222222222'
const SAVING = '33333333-3333-4333-8333-333333333333'
const PLAN = '44444444-4444-4444-8444-444444444444'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  saving: { linked_deposit_tx_id: '11111111-1111-4111-8111-111111111111' } as unknown,
  plan: { id: '44444444-4444-4444-8444-444444444444', month: 8, year: 2026 } as unknown,
  rpcResult: { data: { transaction_id: '22222222-2222-4222-8222-222222222222' } as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  updates: null as Record<string, unknown> | null,
  updateResult: { data: { transaction_id: '11111111-1111-4111-8111-111111111111' } as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      let op: 'select' | 'update' = 'select'
      const c: Record<string, unknown> = {
        select: () => c,
        eq: () => c,
        update: (payload: Record<string, unknown>) => { op = 'update'; h.updates = payload; return c },
        single: async () => {
          if (op === 'update') return h.updateResult
          return table === 'recurring_savings'
            ? { data: h.saving, error: null }
            : { data: h.plan, error: null }
        },
      }
      return c
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args })
      return { single: async () => h.rpcResult }
    },
  }),
}))

const { POST, DELETE } = await import('../route')

const BODY = {
  amount_vnd: 2_000_000,
  interest_rate: 4.2,
  investment_date: '2026-08-04',
  expiry_date: '2027-08-04',
  top_up_lock_days: 30,
}

const call = (body: Record<string, unknown> = BODY) =>
  POST(
    new Request(`https://app.test/api/v1/investment-transactions/${BOOK}/successor`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: BOOK }) },
  )

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.saving = { linked_deposit_tx_id: BOOK }
  h.plan = { id: PLAN, month: 8, year: 2026 }
  h.rpcResult = { data: { transaction_id: NEW_BOOK }, error: null }
  h.rpcCalls = []
  h.updates = null
  h.updateResult = { data: { transaction_id: BOOK }, error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/v1/investment-transactions/[id]/successor (#638)', () => {
  it('opens the successor through the atomic RPC', async () => {
    const res = await call()

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ transaction_id: NEW_BOOK })
    expect(h.rpcCalls).toHaveLength(1)
    expect(h.rpcCalls[0]).toMatchObject({
      name: 'open_successor_book',
      args: {
        p_source_book_id: BOOK,
        p_amount_vnd: 2_000_000,
        p_interest_rate: 4.2,
        p_investment_date: '2026-08-04',
        p_expiry_date: '2027-08-04',
        p_top_up_lock_days: 30,
        p_saving_id: null,
        p_ym: null,
      },
    })
  })

  it('carries the recurring saving and its month into the same call', async () => {
    await call({ ...BODY, saving_id: SAVING, ym: '2026-08', plan_id: PLAN })

    expect(h.rpcCalls[0].args).toMatchObject({
      p_saving_id: SAVING, p_ym: '2026-08', p_plan_id: PLAN,
    })
  })

  // The tranche carries the plan while the fulfillment is filed under ym; if
  // they name different months, one month shows a contribution whose deposit it
  // cannot find and the other counts a deposit it never planned.
  it('refuses a plan from a different month than the contribution', async () => {
    h.plan = { id: PLAN, month: 7, year: 2026 }

    const res = await call({ ...BODY, saving_id: SAVING, ym: '2026-08', plan_id: PLAN })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('accepts a plan for the same month', async () => {
    const res = await call({ ...BODY, saving_id: SAVING, ym: '2026-08', plan_id: PLAN })

    expect(res.status).toBe(201)
    expect(h.rpcCalls[0].args).toMatchObject({ p_plan_id: PLAN, p_ym: '2026-08' })
  })

  it('rejects an anonymous caller', async () => {
    h.user = null
    expect((await call()).status).toBe(401)
  })

  it('rejects a maturity that is not after the contribution', async () => {
    const res = await call({ ...BODY, expiry_date: '2026-08-04' })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('rejects a book opened without a rate', async () => {
    const res = await call({ ...BODY, interest_rate: null })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('rejects a contribution dated in the future', async () => {
    const res = await call({ ...BODY, investment_date: '2099-01-01' })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('refuses to move a recurring saving that is linked to another book', async () => {
    h.saving = { linked_deposit_tx_id: NEW_BOOK }

    const res = await call({ ...BODY, saving_id: SAVING, ym: '2026-08' })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('reports a book that already has a successor as a conflict, not a fault', async () => {
    h.rpcResult = { data: null, error: { message: 'successor book: this book already has a successor' } }

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'This book already has a successor.' })
  })

  it('reports a missing book as a 404', async () => {
    h.rpcResult = { data: null, error: { message: 'successor book: accumulating book not found' } }

    expect((await call()).status).toBe(404)
  })

  // The database refuses to close a promised book, so the promise has to be
  // withdrawable on purpose — otherwise the old deposit could never be closed.
  describe('DELETE — cancelling the handover', () => {
    const del = () =>
      DELETE(
        new Request(`https://app.test/api/v1/investment-transactions/${BOOK}/successor`, { method: 'DELETE' }) as unknown as NextRequest,
        { params: Promise.resolve({ id: BOOK }) },
      )

    it('clears the link and leaves the successor book alone', async () => {
      const res = await del()

      expect(res.status).toBe(200)
      expect(h.updates).toMatchObject({ successor_deposit_tx_id: null })
      await expect(res.json()).resolves.toMatchObject({ successor_deposit_tx_id: null })
    })

    // The tranche carries the plan while the fulfillment is filed under ym; if
  // they name different months, one month shows a contribution whose deposit it
  // cannot find and the other counts a deposit it never planned.
  it('refuses a plan from a different month than the contribution', async () => {
    h.plan = { id: PLAN, month: 7, year: 2026 }

    const res = await call({ ...BODY, saving_id: SAVING, ym: '2026-08', plan_id: PLAN })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('accepts a plan for the same month', async () => {
    const res = await call({ ...BODY, saving_id: SAVING, ym: '2026-08', plan_id: PLAN })

    expect(res.status).toBe(201)
    expect(h.rpcCalls[0].args).toMatchObject({ p_plan_id: PLAN, p_ym: '2026-08' })
  })

  it('rejects an anonymous caller', async () => {
      h.user = null
      expect((await del()).status).toBe(401)
    })

    it('answers 404 for a deposit that is not the caller\'s', async () => {
      h.updateResult = { data: null, error: null }
      expect((await del()).status).toBe(404)
    })
  })
})
