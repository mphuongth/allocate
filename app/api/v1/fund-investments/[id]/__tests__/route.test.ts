import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { PUT, DELETE } = await import('../route')

describe('legacy /api/v1/fund-investments/[id] mutations', () => {
  beforeEach(() => {
    h.clientCreated = false
    h.tables = []
  })

  // Both handlers take no parameters at all — not the request, not the route
  // params. That is the removal made structural: there is no id to look up and
  // no body to apply, so no edit to this file can quietly grow back into a write.
  it('answers PUT with 410 Gone', async () => {
    const res = await PUT()

    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.code).toBe('gone')
    // Point the caller at the endpoint that does enforce the invariants.
    expect(body.error).toMatch(/investment-transactions/)
  })

  it('answers DELETE with 410 Gone', async () => {
    const res = await DELETE()

    expect(res.status).toBe(410)
    await expect(res.json()).resolves.toMatchObject({ code: 'gone' })
  })

  // The whole safety argument. If either handler still opened a client it could
  // still write, and a later edit could quietly restore the unguarded update.
  it('never reaches the database', async () => {
    await PUT()
    await DELETE()

    expect(h.clientCreated).toBe(false)
    expect(h.tables).toEqual([])
  })
})
