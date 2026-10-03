import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The DCA lines a deposit was parked for (park_dca_lines_in_deposit), each with
// the share it put in. The maturity sheet splits the payout back into those
// funds by these shares.

const DEP = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  result: { data: [] as unknown[] | null, error: null as unknown },
  filters: [] as [string, unknown][],
  table: '' as string,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      h.table = table
      const c: Record<string, unknown> = {
        select: () => c,
        eq: (col: string, val: unknown) => { h.filters.push([col, val]); return c },
        order: () => c,
        then: (resolve: (v: unknown) => void) => resolve(h.result),
      }
      return c
    },
  }),
}))

const { GET } = await import('../route')

const call = (id = DEP) =>
  GET(new NextRequest(`https://app.test/api/v1/investment-transactions/${id}/parked-lines`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.filters = []
  h.result = { data: [], error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/v1/investment-transactions/[id]/parked-lines', () => {
  it('rejects an unauthenticated request', async () => {
    h.user = null
    expect((await call()).status).toBe(401)
  })

  it('refuses a malformed id', async () => {
    expect((await call('nope')).status).toBe(400)
  })

  it("lists the deposit's parked lines with their shares", async () => {
    h.result = { data: [
      { fund_id: 'f-1', parked_amount_vnd: 1_000_000 },
      { fund_id: 'f-2', parked_amount_vnd: 1_500_000 },
    ], error: null }
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ fund_id: 'f-1', share: 1_000_000 }, { fund_id: 'f-2', share: 1_500_000 }])
    expect(h.table).toBe('plan_dca_skips')
    expect(h.filters).toContainEqual(['parked_in_tx_id', DEP])
  })

  it('answers an empty list for a deposit that parked nothing', async () => {
    expect(await (await call()).json()).toEqual([])
  })

  it('fails closed on a read error', async () => {
    h.result = { data: null, error: { message: 'boom' } }
    expect((await call()).status).toBe(500)
  })
})
