import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// update_deposit_book reads the tranche's book without a lock, takes the whole
// group in transaction_id order, then re-reads to confirm the book is still the
// one it locked (#653). If it is not — dissolved, or the tranche gone — it
// aborts with "book changed since load" rather than writing to a book that no
// longer exists.
//
// The collapse and merge-successor routes already answer that message with a
// 409 and "reload"; the book edit is the third door to the same race, and it
// used to report it as a server fault.

const TX_ID = '11111111-1111-4111-8111-111111111111'
const GOAL_ID = '22222222-2222-4222-8222-222222222222'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { deposit_group_id: 'book-1' as string | null, asset_type: 'bank' as string | null },
  rpcResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  function chainFor(table: string) {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      update: () => c,
      single: async () => {
        if (table === 'savings_goals') return { data: { goal_id: GOAL_ID }, error: null }
        return { data: h.existing, error: null }
      },
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chainFor(table),
      rpc: () => ({ single: async () => h.rpcResult }),
    }),
  }
})

const { PUT } = await import('../route')

const put = () =>
  PUT(
    new Request(`https://app.test/api/v1/investment-transactions/${TX_ID}`, {
      method: 'PUT',
      body: JSON.stringify({ asset_type: 'bank', amount_vnd: 5_000_000, goal_id: GOAL_ID }),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: TX_ID }) },
  )

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.existing = { deposit_group_id: 'book-1', asset_type: 'bank' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/v1/investment-transactions/[id] — a book that changed under the edit', () => {
  it('answers 409 and asks for a reload', async () => {
    h.rpcResult = { data: null, error: { message: 'update_deposit_book: book changed since load, reload and retry' } }

    const res = await put()

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/reload/i) })
  })

  it('still reports an unrelated failure as a 500', async () => {
    h.rpcResult = { data: null, error: { message: 'deadlock detected' } }

    const res = await put()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'Failed to update deposit book' })
  })
})
