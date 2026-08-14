import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Closing a book locks its anchor and then each tranche, while an ordinary
// withdrawal from one of those tranches holds that tranche and then waits for the
// anchor in the recurring-link unlinker (#650). Neither lock is optional, so the
// cycle stays — and the honest answer to losing it is "try again", not a 500 that
// reads as a server fault for a request that was fine and wrote nothing.

const BOOK = '11111111-2222-4333-8444-555555555555'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  anchor: { data: null as unknown, error: null as unknown },
  rpc: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        single: async () => h.anchor,
      }
      return chain
    },
    rpc: async () => h.rpc,
  }),
}))

const { POST } = await import('../route')

const call = () =>
  POST(
    new Request(`https://app.test/api/v1/investment-transactions/${BOOK}/withdraw-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdraw_principal: 1_000_000,
        total_received: 1_010_000,
        investment_date: '2026-08-01',
      }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: BOOK }) },
  )

describe('POST /investment-transactions/:id/withdraw-book — contention', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.anchor = { data: { asset_type: 'bank', deposit_group_id: BOOK }, error: null }
    h.rpc = { data: null, error: null }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it.each([
    ['40P01', 'deadlock detected'],
    ['55P03', 'could not obtain lock on row'],
    ['40001', 'could not serialize access'],
  ])('answers %s with a retryable conflict rather than a 500', async (code, message) => {
    h.rpc = { data: null, error: { code, message } }

    const res = await call()

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'book_busy' })
  })

  // Without this the map above could swallow a real fault and tell the user to
  // keep retrying something that will never work.
  it('still reports a genuine failure as one', async () => {
    h.rpc = { data: null, error: { code: 'XX000', message: 'something broke' } }

    expect((await call()).status).toBe(500)
  })

  it('passes a successful close through', async () => {
    h.rpc = { data: 2, error: null }

    const res = await call()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ withdrawn_tranches: 2 })
  })
})
