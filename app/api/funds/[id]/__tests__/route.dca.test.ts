import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the payload handed to supabase .update() and stub the auth + query chain.
const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  user: { id: 'user-1' } as { id: string } | null,
  result: { data: { id: 'f1' }, error: null } as { data: unknown; error: unknown },
  // The pending-row cleanup on DCA-disable issues a separate .delete() chain;
  // capture its filters (null until a delete happens).
  deleteFilters: null as Record<string, unknown> | null,
  inDelete: false,
}))

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    update: (payload: Record<string, unknown>) => { h.captured = payload; return chain },
    delete: () => { h.inDelete = true; h.deleteFilters = {}; return chain },
    select: () => chain,
    eq: (col: string, val: unknown) => { if (h.inDelete) h.deleteFilters![col] = val; return chain },
    is: (col: string, val: unknown) => { if (h.inDelete) h.deleteFilters![col] = val; return chain },
    single: async () => h.result,
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
    }),
  }
})

import { PUT } from '../route'

function makeReq(body: Record<string, unknown>) {
  return { json: async () => body } as unknown as Parameters<typeof PUT>[0]
}
const ctx = { params: Promise.resolve({ id: 'f1' }) }

const baseBody = { name: 'VFMVF1 Equity', code: 'VFMVF1', fund_type: 'equity', nav: 36120 }

beforeEach(() => {
  h.captured = null
  h.user = { id: 'user-1' }
  h.result = { data: { id: 'f1' }, error: null }
  h.deleteFilters = null
  h.inDelete = false
})

describe('PUT /api/funds/[id] — DCA fields use partial-update semantics (sibling of #411)', () => {
  it('a name/NAV edit that omits is_dca must NOT touch the DCA columns', async () => {
    const res = await PUT(makeReq(baseBody), ctx)
    expect(res.status).toBe(200)
    // The Add/Edit form sends only name/code/type/nav — DCA config must be preserved,
    // not silently wiped by defaulting is_dca to false.
    expect(h.captured).not.toHaveProperty('is_dca')
    expect(h.captured).not.toHaveProperty('dca_monthly_amount_vnd')
    expect(h.captured).not.toHaveProperty('dca_goal_id')
    expect(h.captured!.name).toBe('VFMVF1 Equity')
    expect(h.captured!.nav).toBe(36120)
    // Not a disable, so no pending-row cleanup runs.
    expect(h.deleteFilters).toBeNull()
  })

  it('an explicit is_dca:false still clears the DCA columns', async () => {
    await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    expect(h.captured!.is_dca).toBe(false)
    expect(h.captured!.dca_monthly_amount_vnd).toBeNull()
    expect(h.captured!.dca_goal_id).toBeNull()
  })

  it('disabling DCA retires the fund\'s pending seeded rows, sparing recorded buys (#473)', async () => {
    await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    // A scoped delete of only this fund's un-recorded seeded rows for this user.
    expect(h.deleteFilters).toEqual({
      user_id: 'user-1',
      fund_id: 'f1',
      asset_type: 'fund',
      is_dca_seeded: true,
      units: null,
    })
  })

  it('an explicit is_dca:true persists amount + goal and does not delete rows', async () => {
    const goal = '11111111-1111-1111-1111-111111111111'
    await PUT(makeReq({ ...baseBody, is_dca: true, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: goal }), ctx)
    expect(h.captured!.is_dca).toBe(true)
    expect(h.captured!.dca_monthly_amount_vnd).toBe(2_000_000)
    expect(h.captured!.dca_goal_id).toBe(goal)
    expect(h.deleteFilters).toBeNull()
  })
})
