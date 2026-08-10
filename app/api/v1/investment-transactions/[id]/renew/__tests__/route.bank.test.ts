import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Moving a renewed deposit to another bank (#640).
//
// `bank_code` is applied by renew_term_deposit_with_merge, which the route used
// to reach only when sibling deposits were being folded in. A user settling ONE
// maturing deposit and re-depositing at a different bank has nothing to merge,
// so the bank change was silently dropped — the only way out was to withdraw the
// deposit by hand and re-enter it, which loses the renewal history.
//
// Routing a bank change through the merge RPC with empty source arrays is safe:
// its merge loop runs `1 .. coalesce(array_length(ids, 1), 0)` — no iterations,
// no merge total — so the roll-forward, snapshot and re-parent are identical to
// the plain function's, plus `bank_code = coalesce(p_bank_code, bank_code)`.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  old: {
    asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 6,
    expiry_date: '2026-07-01', deposit_group_id: null,
  } as Record<string, unknown> | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const c: Record<string, unknown> = {
        select: () => c,
        eq: () => c,
        single: async () => ({ data: h.old, error: h.old ? null : { message: 'not found' } }),
      }
      return c
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args })
      return { single: async () => ({ data: { transaction_id: TX_ID }, error: null }) }
    },
  }),
}))

const { POST } = await import('../route')

const TX_ID = '88888888-8888-4888-8888-888888888888'
const SIBLING_ID = '99999999-9999-4999-8999-999999999999'

const call = (body: Record<string, unknown>) =>
  POST(
    new Request(`https://app.test/api/v1/investment-transactions/${TX_ID}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: TX_ID }) },
  )

const baseBody = {
  amount_vnd: 10_600_000,
  interest_rate: 6.5,
  expiry_date: '2027-01-01',
  investment_date: '2026-07-01',
  interest_earned_vnd: 600_000,
}

beforeEach(() => {
  h.rpcCalls.length = 0
})

describe('POST /renew — destination bank', () => {
  it('routes a bank change with no merge sources through the merge RPC', async () => {
    const res = await call({ ...baseBody, bank_code: 'VCB' })

    expect(res.status).toBe(200)
    expect(h.rpcCalls).toHaveLength(1)
    const [{ fn, args }] = h.rpcCalls
    expect(fn).toBe('renew_term_deposit_with_merge')
    expect(args.p_bank_code).toBe('VCB')
    // Nothing is merged — the arrays must stay empty so the RPC's loop is a no-op
    // and the principal is exactly what the renewal computed.
    expect(args.p_merge_source_ids).toEqual([])
    expect(args.p_merge_received).toEqual([])
    expect(args.p_held_source_ids).toEqual([])
    expect(args.p_amount_vnd).toBe(10_600_000)
  })

  it('still uses the plain RPC when no bank change is asked for', async () => {
    const res = await call(baseBody)

    expect(res.status).toBe(200)
    expect(h.rpcCalls[0].fn).toBe('renew_term_deposit')
  })

  it('carries the bank alongside merged sources, as before', async () => {
    await call({ ...baseBody, bank_code: 'MB', merge_sources: [{ tx_id: SIBLING_ID, received: 3_000_000 }] })

    const [{ fn, args }] = h.rpcCalls
    expect(fn).toBe('renew_term_deposit_with_merge')
    expect(args.p_bank_code).toBe('MB')
    expect(args.p_merge_source_ids).toEqual([SIBLING_ID])
  })

  it('rejects a junk bank code before touching the database', async () => {
    const res = await call({ ...baseBody, bank_code: 'not a bank' })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })
})
