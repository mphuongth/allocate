import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Restoring a skipped DCA deletes the skip. A DCA parked in a deposit cannot be
// restored that way — the database refuses (the DCA would come back beside the
// deposit already counted for the month); undo is deleting the deposit. That
// refusal is the user's to act on, so it is a 409 that says so, not a 404.

const PLAN = '11111111-1111-4111-8111-111111111111'
const FUND = '33333333-3333-4333-8333-333333333333'

const h = vi.hoisted(() => ({ deleteError: null as unknown }))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      const c: Record<string, unknown> = {
        select: () => c, eq: () => c,
        single: async () => ({ data: { id: PLAN }, error: null }),
        delete: () => c,
        then: (r: (v: unknown) => void) => r({ error: table === 'plan_dca_skips' ? h.deleteError : null }),
      }
      return c
    },
  }),
}))

const { DELETE } = await import('../route')
const call = () => DELETE(new NextRequest(`https://app.test/x`, { method: 'DELETE' }), { params: Promise.resolve({ id: PLAN, fundId: FUND }) })

beforeEach(() => { h.deleteError = null })

describe('DELETE /api/v1/monthly-plans/[id]/dca-skips/[fundId]', () => {
  it('restores a skipped DCA', async () => {
    expect((await call()).status).toBe(204)
  })

  it('refuses a parked DCA with a 409 that names the way out', async () => {
    h.deleteError = { code: '23514', message: 'park dca: this DCA was parked in a deposit — delete the deposit to undo it' }
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'dca_parked', error: 'this DCA was parked in a deposit — delete the deposit to undo it' })
  })
})
