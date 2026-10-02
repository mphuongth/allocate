import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// A term deposit names the fund its money moves to when it is not renewed at
// maturity (20261001000001). The column only exists on a single bank term
// deposit — a book's tranches are settled by the book flows, a flex deposit
// never matures, and a fund, gold or withdrawal row is not a deposit — and the
// fund must be the caller's own. The table refuses all of that; the route says
// so as a 400/403 instead of a constraint error.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  inserts: [] as Record<string, unknown>[],
  fund: { data: { id: 'fund-1' } as unknown, error: null as unknown },
  rows: {} as Record<string, unknown>,
  insertResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    let rowId: string | null = null
    const c: Record<string, unknown> = {
      select: () => c,
      insert: (payload: Record<string, unknown>) => { op = 'insert'; h.inserts.push(payload); return c },
      update: () => { op = 'update'; return c },
      // The id being looked up decides which row comes back: a withdrawal's
      // parent and a top-up's anchor are both reads of this table, and the two
      // are different rows.
      eq: (col: string, val: string) => { if (col === 'transaction_id') rowId = val; return c },
      is: () => c,
      not: () => c,
      single: async () => {
        if (op === 'insert') return h.insertResult
        if (table === 'funds') return h.fund
        if (table !== 'investment_transactions') return { data: null, error: null }
        return { data: (rowId && h.rows[rowId]) || null, error: null }
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
const BOOK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const call = (body: Record<string, unknown>) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const TERM = {
  asset_type: 'bank',
  transaction_type: 'investment',
  investment_date: '2026-07-01',
  amount_vnd: 10_000_000,
  interest_rate: 6,
  expiry_date: '2027-01-01',
  target_fund_id: FUND_ID,
}

describe('POST /api/v1/investment-transactions — a deposit\'s target fund', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.inserts = []
    h.fund = { data: { id: FUND_ID }, error: null }
    h.rows = {
      [BOOK_ID]: {
        transaction_id: BOOK_ID, asset_type: 'bank', deposit_group_id: BOOK_ID,
        goal_id: null, expiry_date: '2027-07-01', bank_code: null, top_up_lock_days: null,
      },
    }
    h.insertResult = { data: { transaction_id: 'new-tx' }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('stores the target fund on a term deposit', async () => {
    const res = await call(TERM)
    expect(res.status).toBe(201)
    expect(h.inserts[0].target_fund_id).toBe(FUND_ID)
  })

  it('stores no target fund when none is chosen', async () => {
    const res = await call({ ...TERM, target_fund_id: null })
    expect(res.status).toBe(201)
    expect(h.inserts[0].target_fund_id).toBeNull()
  })

  it('refuses another user\'s fund as the target', async () => {
    h.fund = { data: null, error: null }
    const res = await call(TERM)
    expect(res.status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })

  it('refuses a malformed target fund id', async () => {
    const res = await call({ ...TERM, target_fund_id: 'not-a-uuid' })
    expect(res.status).toBe(400)
    expect(h.inserts).toHaveLength(0)
  })

  it.each([
    ['an accumulating book', { accumulating: true }],
    ['a top-up tranche', { tops_up_deposit_id: BOOK_ID }],
    ['a flex deposit', { interest_rate: null, expiry_date: null }],
    ['a fund purchase', { asset_type: 'fund', fund_id: FUND_ID, units: 10, unit_price: 1_000_000, interest_rate: null, expiry_date: null }],
    ['a withdrawal', { transaction_type: 'withdrawal' }],
  ])('refuses a target fund on %s', async (_label, over) => {
    const res = await call({ ...TERM, ...over })
    expect(res.status).toBe(400)
    expect(h.inserts).toHaveLength(0)
  })
})
