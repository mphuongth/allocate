import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the payload handed to supabase .update() and stub the auth + query chain.
const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  user: { id: 'user-1' } as { id: string } | null,
  result: { data: { id: 'f1' }, error: null } as { data: unknown; error: unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    update: (payload: Record<string, unknown>) => { h.captured = payload; return chain },
    select: () => chain,
    eq: () => chain,
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
  })

  it('an explicit is_dca:false still clears the DCA columns', async () => {
    await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    expect(h.captured!.is_dca).toBe(false)
    expect(h.captured!.dca_monthly_amount_vnd).toBeNull()
    expect(h.captured!.dca_goal_id).toBeNull()
  })

  it('an explicit is_dca:true persists amount + goal', async () => {
    const goal = '11111111-1111-1111-1111-111111111111'
    await PUT(makeReq({ ...baseBody, is_dca: true, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: goal }), ctx)
    expect(h.captured!.is_dca).toBe(true)
    expect(h.captured!.dca_monthly_amount_vnd).toBe(2_000_000)
    expect(h.captured!.dca_goal_id).toBe(goal)
  })
})
