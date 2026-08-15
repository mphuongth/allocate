import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// A merge into a deposit pledged as collateral is refused by the database
// (#635): the cash would land inside a balance the user cannot withdraw until
// the pledge is released. The sheet no longer offers such an anchor, so anyone
// reaching this has gone around the UI — but the answer still has to be the
// user's rule, named, rather than the catch-all 500 every other RPC refusal on
// this route gets.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  old: {
    asset_type: 'bank', amount_vnd: 10_000_000, interest_rate: 6,
    expiry_date: '2026-07-01', deposit_group_id: null,
  } as Record<string, unknown> | null,
  rpcError: null as { message: string; code?: string } | null,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const c: Record<string, unknown> = {
        select: () => c,
        eq: () => c,
        single: async () => ({ data: h.old, error: null }),
      }
      return c
    },
    rpc: () => ({
      single: async () =>
        h.rpcError ? { data: null, error: h.rpcError } : { data: { transaction_id: TX_ID }, error: null },
    }),
  }),
}))

const { POST } = await import('../route')

const TX_ID = '88888888-8888-4888-8888-888888888888'
const HELD_ID = '77777777-7777-4777-8777-777777777777'

const call = () =>
  POST(
    new Request(`https://app.test/api/v1/investment-transactions/${TX_ID}/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_vnd: 10_600_000,
        interest_rate: 6.5,
        expiry_date: '2027-01-01',
        investment_date: '2026-07-01',
        interest_earned_vnd: 600_000,
        held_sources: [HELD_ID],
      }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: TX_ID }) },
  )

beforeEach(() => {
  h.rpcError = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /renew — merging into pledged collateral', () => {
  it('reports the collateral rule as a conflict, naming the remedy', async () => {
    h.rpcError = {
      code: '23514',
      message: 'pledged deposit: this deposit is pledged as collateral, so money cannot be merged into it — release the pledge first',
    }

    const res = await call()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('pledged_destination')
    expect(body.error).toMatch(/pledge/i)
    // The prefix marks the message as ours; it is not part of the sentence.
    expect(body.error).not.toMatch(/^pledged deposit: /)
  })

  // Anything without the prefix is not a rule we wrote — it stays a fault, and
  // echoing it would leak database internals as if it were advice.
  it('still reports an unrelated failure as a 500', async () => {
    h.rpcError = { code: 'XX000', message: 'deadlock detected' }

    const res = await call()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Failed to renew deposit' })
  })
})
