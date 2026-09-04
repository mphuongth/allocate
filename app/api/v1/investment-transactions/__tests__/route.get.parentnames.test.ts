import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// A withdrawal carries no notes of its own — SellWithdrawSheet posts only
// parent_transaction_id, amount and principal — so a row like "rút 55tr từ
// PVcombank" named nothing more specific than its asset type. The name lives
// on the SOURCE the withdrawal drew from (parent_transaction_id), attached
// here in one batched follow-up query, not guessed at or copied onto the
// withdrawal when it was written (#712 follow-up).

const WD_ID = 'aaaaaaaa-0000-4000-8000-000000000001'
const PARENT_ID = 'bbbbbbbb-0000-4000-8000-000000000002'
const INV_ID = 'cccccccc-0000-4000-8000-000000000003'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  page: [] as Record<string, unknown>[],
  parents: [] as Record<string, unknown>[],
  parentErr: null as { message: string } | null,
  inCalls: [] as { column: string; values: unknown }[],
}))

vi.mock('@/lib/supabase-server', () => {
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      // The route issues two independent `.from('investment_transactions')`
      // calls: the paginated list, then (only when a withdrawal needs one) a
      // batched lookup of parent notes. Each gets its own chain and its own
      // resolved data, so the mock has to tell them apart rather than
      // answering every `.from()` the same way like the single-query routes do.
      from: () => {
        const q: Record<string, unknown> = {}
        let isLookup = false
        Object.assign(q, {
          select: () => q, eq: () => q, is: () => q, gte: () => q, lte: () => q,
          order: () => q, range: () => q,
          in: (column: string, values: unknown) => {
            h.inCalls.push({ column, values })
            isLookup = true
            return q
          },
          then: (resolve: (v: unknown) => unknown) =>
            resolve(
              isLookup
                ? { data: h.parents, error: h.parentErr, count: null }
                : { data: h.page, error: null, count: h.page.length },
            ),
        })
        return q
      },
    }),
  }
})

const { GET } = await import('../route')

const get = () =>
  GET(new Request('https://app.test/api/v1/investment-transactions') as unknown as NextRequest)

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.page = []
  h.parents = []
  h.parentErr = null
  h.inCalls = []
})

describe('GET /api/v1/investment-transactions — parentNotes on withdrawal rows (#712 follow-up)', () => {
  it('attaches the parent source name to a withdrawal that has none of its own', async () => {
    h.page = [{
      transaction_id: WD_ID, transaction_type: 'withdrawal', asset_type: 'bank',
      parent_transaction_id: PARENT_ID, notes: null,
    }]
    h.parents = [{ transaction_id: PARENT_ID, notes: 'PVcombank' }]

    const res = await get()
    const body = await res.json()

    expect(h.inCalls).toEqual([{ column: 'transaction_id', values: [PARENT_ID] }])
    expect(body.transactions[0].parentNotes).toBe('PVcombank')
  })

  it('does not query at all when nothing on the page needs it', async () => {
    h.page = [{
      transaction_id: INV_ID, transaction_type: 'investment', asset_type: 'bank',
      parent_transaction_id: null, notes: 'PVcombank',
    }]

    const res = await get()
    const body = await res.json()

    expect(h.inCalls).toHaveLength(0)
    expect(body.transactions[0].parentNotes).toBeUndefined()
  })

  it('dedupes parent ids shared by multiple withdrawals into one lookup', async () => {
    h.page = [
      { transaction_id: 'w1', transaction_type: 'withdrawal', parent_transaction_id: PARENT_ID, notes: null },
      { transaction_id: 'w2', transaction_type: 'withdrawal', parent_transaction_id: PARENT_ID, notes: null },
    ]
    h.parents = [{ transaction_id: PARENT_ID, notes: 'NCB' }]

    await get()

    expect(h.inCalls).toEqual([{ column: 'transaction_id', values: [PARENT_ID] }])
  })

  it('degrades to no parentNotes, not a 500, when the lookup itself fails', async () => {
    h.page = [{
      transaction_id: WD_ID, transaction_type: 'withdrawal',
      parent_transaction_id: PARENT_ID, notes: null,
    }]
    h.parentErr = { message: 'boom' }

    const res = await get()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.transactions[0].parentNotes).toBeUndefined()
  })
})
