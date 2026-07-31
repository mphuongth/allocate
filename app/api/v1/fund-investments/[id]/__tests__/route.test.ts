import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// The legacy fund-investments row endpoint used to expose PUT and DELETE that
// wrote straight to investment_transactions (#586):
//
//   • PUT matched on transaction_id + user_id only — no `asset_type = 'fund'`
//     filter — so a fund-shaped body could rewrite a BANK deposit's amount,
//     units and unit_price, and an accumulating book tranche could be edited
//     alone, splitting the book away from its group;
//   • DELETE carried no `consumed_by_inv_id IS NULL` guard, so the withdrawal
//     that closes a merged source could be deleted — re-opening the source at
//     full value while its cash still sits in the anchor (double count).
//
// Nothing calls either path; the canonical /investment-transactions/[id] route
// has both invariants. So they are gone, and the route answers 410 to say so
// permanently rather than 405 (which reads as "wrong verb, try another").
//
// The point of these tests is that the answer costs nothing and reaches no
// database: a removed mutation must not authenticate, read, or write.

const h = vi.hoisted(() => ({
  clientCreated: false,
  tables: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => {
    h.clientCreated = true
    return {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => { h.tables.push(table); throw new Error('unreachable') },
    }
  },
}))

const route = await import('../route')

const TX_ID = '88888888-8888-4888-8888-888888888888'

const call = (method: 'PUT' | 'DELETE', id = TX_ID, body?: unknown) =>
  route[method](
    new Request(`https://app.test/api/v1/fund-investments/${id}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

describe('legacy /api/v1/fund-investments/[id] mutations', () => {
  beforeEach(() => {
    h.clientCreated = false
    h.tables = []
  })

  it('answers PUT with 410 Gone', async () => {
    const res = await call('PUT', TX_ID, { amount_vnd: 1_000_000 })

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.code).toBe('gone')
    // Point the caller at the endpoint that does enforce the invariants.
    expect(body.error).toMatch(/investment-transactions/)
  })

  it('answers DELETE with 410 Gone', async () => {
    const res = await call('DELETE')

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: 'gone' })
  })

  // The whole safety argument. If either handler still opened a client it could
  // still write, and a later edit could quietly restore the unguarded update.
  it('never reaches the database', async () => {
    await call('PUT', TX_ID, { amount_vnd: 1_000_000 })
    await call('DELETE')

    expect(h.clientCreated).toBe(false)
    expect(h.tables).toEqual([])
  })

  // A well-formed id is not a way back in either — the id is never even read.
  it('answers 410 regardless of the id', async () => {
    expect((await call('DELETE', 'not-a-uuid')).status).toBe(410)
  })
})
