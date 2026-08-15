import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// An accumulating book ("Loại 2") is a BANK concept: the anchor self-groups
// (deposit_group_id = its own transaction_id) and every tranche is the same bank
// deposit, which is why the book-level fields — goal, maturity, notes, bank —
// cascade across the group.
//
// The top-up branch has always said so ("Can only top up an accumulating bank
// deposit"). The branch that CREATES a book never checked, so
// `{ asset_type: 'fund', accumulating: true }` wrote a fund row carrying a
// deposit_group_id — a shape nothing downstream expects (#618). lib/mergeEligibility
// reads a group as "a book, not a single deposit"; update_deposit_book cascades
// book-level fields across the group without asking what the rows are.
//
// This is request validation, so it is tested here rather than in an E2E. The
// table carries the same rule as a constraint (20260815000002), for the writers
// that never come through this route.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  inserts: [] as Record<string, unknown>[],
  fund: { data: { id: 'fund-1' } as unknown, error: null as unknown },
  parent: { data: { transaction_id: 'parent-1', deposit_group_id: null, asset_type: 'bank' } as unknown, error: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      insert: (payload: Record<string, unknown>) => { op = 'insert'; h.inserts.push(payload); return c },
      update: () => { op = 'update'; return c },
      eq: () => c,
      is: () => c,
      not: () => c,
      single: async () => {
        if (op === 'insert') return h.insertResult
        if (table === 'funds') return h.fund
        return table === 'investment_transactions' ? h.parent : { data: null, error: null }
      },
      maybeSingle: async () => (table === 'funds' ? h.fund : { data: null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
      rpc: () => ({ single: async () => ({ data: null, error: null }) }),
    }),
  }
})

const { POST } = await import('../route')

const FUND_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const PARENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const call = (body: Record<string, unknown>) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const BANK_BOOK = {
  asset_type: 'bank',
  transaction_type: 'investment',
  investment_date: '2026-07-01',
  amount_vnd: 10_000_000,
  interest_rate: 5.5,
  expiry_date: '2027-07-01',
  accumulating: true,
}

describe('POST /api/v1/investment-transactions — accumulating is a bank shape', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.inserts = []
    h.fund = { data: { id: FUND_ID }, error: null }
    h.parent = { data: { transaction_id: PARENT_ID, deposit_group_id: null, asset_type: 'bank' }, error: null }
    h.insertResult = { data: { transaction_id: 'new-tx' }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a bank book whose anchor groups itself', async () => {
    const res = await call(BANK_BOOK)

    expect(res.status).toBe(201)
    const row = h.inserts[0]
    // The anchor IS the book: deposit_group_id is not null ⇔ accumulating, and
    // the anchor is the row whose group equals its own id.
    expect(row.deposit_group_id).toBeTruthy()
    expect(row.deposit_group_id).toBe(row.transaction_id)
    expect(row.asset_type).toBe('bank')
  })

  it('refuses a fund book, and writes nothing', async () => {
    const res = await call({
      ...BANK_BOOK,
      asset_type: 'fund',
      fund_id: FUND_ID,
      interest_rate: undefined,
      expiry_date: undefined,
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/bank/i) })
    expect(h.inserts).toEqual([])
  })

  it('refuses a gold book, and writes nothing', async () => {
    const res = await call({ ...BANK_BOOK, asset_type: 'gold', interest_rate: undefined, expiry_date: undefined })

    expect(res.status).toBe(400)
    expect(h.inserts).toEqual([])
  })

  // A book is made of deposits, so its anchor is an investment. A withdrawal
  // that self-groups would be read as a live book by every path that keys on
  // deposit_group_id alone, holding a balance nothing put there. Parent-backed
  // on purpose: a parentless withdrawal is refused earlier for another reason,
  // and would pass this test without the rule under test existing.
  it('refuses a withdrawal that asks to be a book', async () => {
    const res = await call({
      asset_type: 'bank',
      transaction_type: 'withdrawal',
      investment_date: '2026-07-01',
      amount_vnd: 1_000_000,
      parent_transaction_id: PARENT_ID,
      principal_withdrawn: 1_000_000,
      accumulating: true,
    })

    expect(res.status).toBe(400)
    expect(h.inserts).toEqual([])
  })

  // Without the flag nothing changes: an ordinary fund purchase is not a book.
  it('leaves an ordinary fund purchase alone', async () => {
    const res = await call({
      asset_type: 'fund',
      transaction_type: 'investment',
      investment_date: '2026-07-01',
      amount_vnd: 5_000_000,
      fund_id: FUND_ID,
    })

    expect(res.status).toBe(201)
    expect(h.inserts[0].deposit_group_id).toBeNull()
  })
})
