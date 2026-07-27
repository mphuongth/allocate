import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Collapsing an accumulating book values each tranche on its EFFECTIVE
// principal — amount_vnd minus whatever was partially withdrawn from it — and
// hands the resulting per-tranche interest to collapse_accumulating_book, which
// writes it onto the history snapshot.
//
// The withdrawals query dropped its error (#527). `withdrawals ?? []` then made
// a failed read look identical to "this book has no withdrawals", so every
// tranche was valued on its ORIGINAL principal and the inflated interest was
// persisted by the RPC. Unlike a bad read that merely renders wrong, this one
// writes: the overstated interest becomes permanent financial history that no
// retry undoes.
//
// The fixture is deterministic by construction: the tranche matured on
// 2026-06-01, and calcProjectedInterest caps the accrual window at expiry, so
// the numbers below don't drift as the calendar moves.
//   principal 100,000,000 @ 6% for exactly 365 days → 6,000,000 interest
//   minus a 40,000,000 withdrawal → 60,000,000 @ 6% → 3,600,000 interest

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  anchor: { data: null as unknown, error: null as unknown },
  tranches: { data: [] as unknown[], error: null as unknown },
  withdrawals: { data: [] as unknown[] | null, error: null as unknown },
  rpcResult: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase-server', () => {
  // All three reads hit investment_transactions. The anchor lookup ends in
  // single(); the two list reads are disambiguated by the transaction_type
  // filter the route applies.
  const chain = () => {
    const filters: Record<string, unknown> = {}
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (col: string, val: unknown) => { filters[col] = val; return c },
      is: () => c,
      in: () => c,
      single: async () => h.anchor,
      then: (resolve: (v: unknown) => void) =>
        resolve(filters.transaction_type === 'withdrawal' ? h.withdrawals : h.tranches),
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain(),
      rpc: (name: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ name, args })
        return { single: async () => h.rpcResult }
      },
    }),
  }
})

const { POST } = await import('../route')

const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const TRANCHE_ID = '77777777-7777-4777-8777-777777777777'

const VALID_BODY = {
  amount_vnd: 106_000_000,
  interest_rate: 6,
  expiry_date: '2027-06-01',
  investment_date: '2026-06-01',
}

const call = (body: Record<string, unknown> = VALID_BODY, id = GROUP_ID) =>
  POST(
    new NextRequest(`https://app.test/api/v1/investment-transactions/${id}/collapse`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

const interestSentToRpc = () =>
  (h.rpcCalls[0]?.args.p_tranche_interest as number[] | undefined)?.[0]

function seedHappyPath() {
  h.anchor = { data: { asset_type: 'bank', deposit_group_id: GROUP_ID }, error: null }
  h.tranches = {
    data: [{
      transaction_id: TRANCHE_ID,
      amount_vnd: 100_000_000,
      interest_rate: 6,
      investment_date: '2025-06-01',
      expiry_date: '2026-06-01',
    }],
    error: null,
  }
  h.withdrawals = { data: [], error: null }
  h.rpcResult = { data: { transaction_id: GROUP_ID }, error: null }
}

describe('POST /api/v1/investment-transactions/[id]/collapse', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.rpcCalls = []
    seedHappyPath()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    expect((await call()).status).toBe(401)
  })

  it('returns 400 for a non-positive amount', async () => {
    expect((await call({ ...VALID_BODY, amount_vnd: 0 })).status).toBe(400)
  })

  it('returns 400 when the new maturity is not after the investment date', async () => {
    expect((await call({ ...VALID_BODY, expiry_date: '2026-06-01' })).status).toBe(400)
  })

  it('returns 404 when the anchor does not exist', async () => {
    h.anchor = { data: null, error: { message: 'no rows' } }
    expect((await call()).status).toBe(404)
  })

  it('returns 400 when the deposit is not an accumulating book', async () => {
    h.anchor = { data: { asset_type: 'bank', deposit_group_id: null }, error: null }
    expect((await call()).status).toBe(400)
  })

  it('returns 400 when the book has no tranches', async () => {
    h.tranches = { data: [], error: null }
    expect((await call()).status).toBe(400)
  })

  // ── the regression ───────────────────────────────────────────────────────────
  it('fails closed with 500 when the withdrawal read errors', async () => {
    h.withdrawals = { data: null, error: { message: 'connection reset' } }
    expect((await call()).status).toBe(500)
  })

  it('never invokes the collapse RPC when the withdrawal read errors', async () => {
    h.withdrawals = { data: null, error: { message: 'connection reset' } }
    await call()
    // The whole point: nothing may be written from a principal we couldn't verify.
    expect(h.rpcCalls).toEqual([])
  })

  it('does not leak the database message to the client', async () => {
    h.withdrawals = { data: null, error: { message: 'relation "x" does not exist' } }
    const res = await call()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })

  // ── the behaviour the regression corrupted ───────────────────────────────────
  it('deducts a partial withdrawal before computing interest', async () => {
    h.withdrawals = {
      data: [{ parent_transaction_id: TRANCHE_ID, principal_withdrawn: 40_000_000 }],
      error: null,
    }
    expect((await call()).status).toBe(200)
    expect(interestSentToRpc()).toBe(3_600_000)
  })

  it('values the full principal when the book genuinely has no withdrawals', async () => {
    h.withdrawals = { data: [], error: null }
    expect((await call()).status).toBe(200)
    // Same shape as the failure case above, opposite meaning — this is exactly
    // the distinction `withdrawals ?? []` erased.
    expect(interestSentToRpc()).toBe(6_000_000)
  })

  it('sums multiple withdrawals against the same tranche', async () => {
    h.withdrawals = {
      data: [
        { parent_transaction_id: TRANCHE_ID, principal_withdrawn: 25_000_000 },
        { parent_transaction_id: TRANCHE_ID, principal_withdrawn: 15_000_000 },
      ],
      error: null,
    }
    await call()
    expect(interestSentToRpc()).toBe(3_600_000)
  })

  it('never sends a negative principal when withdrawals exceed the tranche', async () => {
    h.withdrawals = {
      data: [{ parent_transaction_id: TRANCHE_ID, principal_withdrawn: 500_000_000 }],
      error: null,
    }
    await call()
    expect(interestSentToRpc()).toBe(0)
  })

  // ── existing collapse behaviour must survive ─────────────────────────────────
  it('returns 409 when the book changed since load', async () => {
    h.rpcResult = { data: null, error: { message: 'book changed since load' } }
    expect((await call()).status).toBe(409)
  })

  it('returns 500 when the collapse RPC fails', async () => {
    h.rpcResult = { data: null, error: { message: 'deadlock detected' } }
    expect((await call()).status).toBe(500)
  })

  it('returns the collapsed row on success', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ transaction_id: GROUP_ID })
    expect(h.rpcCalls[0].name).toBe('collapse_accumulating_book')
  })
})
