import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture writes and RPC calls while stubbing auth + Supabase query chains.
const h = vi.hoisted(() => ({
  captured: null as Record<string, unknown> | null,
  user: { id: 'user-1' } as { id: string } | null,
  updateResult: { data: { id: 'f1' }, error: null } as { data: unknown; error: unknown },
  rpcResult: { data: { id: 'f1' }, error: null } as { data: unknown; error: unknown },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  // The fund as stored, read before the write so the fund-code check can tell a
  // real pricing change from a DCA edit that merely echoes the current flag.
  previous: { code: 'VFMVF1', nav_auto_sync: false } as { code: string; nav_auto_sync: boolean } | null,
  priceable: true as boolean | null,
}))

// The write-time code check reaches upstream; stub the network, keep the logic.
vi.mock('@/lib/fmarket-nav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/fmarket-nav')>()),
  isFundCodePriceable: async () => h.priceable,
}))

vi.mock('@/lib/supabase-server', () => {
  const chain: Record<string, unknown> = {
    update: (payload: Record<string, unknown>) => { h.captured = payload; return chain },
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: h.previous, error: null }),
    single: async () => h.updateResult,
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain,
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args })
        return { single: async () => h.rpcResult }
      },
    }),
  }
})

import { PUT } from '../route'

// A real Request, not a `{ json }` stand-in: the route reads the body through
// readJsonBody, which reads it as text so an empty body is distinguishable from
// an unparseable one (#566). A stub that only implements `json()` isn't the
// shape the handler actually receives.
function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/funds/f1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PUT>[0]
}
const ctx = { params: Promise.resolve({ id: 'f1' }) }

const baseBody = { name: 'VFMVF1 Equity', code: 'VFMVF1', fund_type: 'equity', nav: 36120 }

beforeEach(() => {
  h.captured = null
  h.user = { id: 'user-1' }
  h.updateResult = { data: { id: 'f1' }, error: null }
  h.rpcResult = { data: { id: 'f1' }, error: null }
  h.rpcCalls = []
  h.previous = { code: 'VFMVF1', nav_auto_sync: false }
  h.priceable = true
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
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('an explicit is_dca:false atomically clears config and pending rows via RPC', async () => {
    const res = await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    expect(res.status).toBe(200)
    expect(h.captured).toBeNull()
    expect(h.rpcCalls).toEqual([{
      fn: 'disable_fund_dca',
      args: {
        p_fund_id: 'f1',
        p_name: 'VFMVF1 Equity',
        p_code: 'VFMVF1',
        p_fund_type: 'equity',
        p_nav: 36120,
        p_nav_auto_sync: null,
      },
    }])
  })

  it('returns an error instead of reporting success when the atomic disable fails', async () => {
    h.rpcResult = { data: null, error: { code: 'XX000', message: 'cleanup failed' } }
    const res = await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update fund' })
  })

  it('404s a missing/foreign fund on the regular update path (PGRST116)', async () => {
    // A zero-row .update().single() surfaces as an error, not null data, so the
    // route must map it to 404 rather than fall through to a generic 500.
    h.updateResult = { data: null, error: { code: 'PGRST116', message: 'no rows' } }
    const res = await PUT(makeReq(baseBody), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Fund not found' })
  })

  it('404s a missing/foreign fund on the disable path (P0002 no_data_found)', async () => {
    h.rpcResult = { data: null, error: { code: 'P0002', message: 'Fund not found' } }
    const res = await PUT(makeReq({ ...baseBody, is_dca: false }), ctx)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Fund not found' })
  })

  it.each([null, 'false', 0])('rejects a non-boolean is_dca value: %j', async (isDca) => {
    const res = await PUT(makeReq({ ...baseBody, is_dca: isDca }), ctx)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'is_dca must be a boolean' })
    expect(h.captured).toBeNull()
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('an explicit is_dca:true persists amount + goal without calling disable RPC', async () => {
    const goal = '11111111-1111-1111-1111-111111111111'
    await PUT(makeReq({ ...baseBody, is_dca: true, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: goal }), ctx)
    expect(h.captured!.is_dca).toBe(true)
    expect(h.captured!.dca_monthly_amount_vnd).toBe(2_000_000)
    expect(h.captured!.dca_goal_id).toBe(goal)
    expect(h.rpcCalls).toHaveLength(0)
  })
})

// Codex, reviewing #644: the fund-code check gated on the flag's *value*, but
// every DCA amount / goal / disable write PUTs the fund's current
// `nav_auto_sync: true` straight back. So any synced fund whose code the feed
// doesn't list — including an opt-in migrated from the old nav_source_url, which
// was never validated against anything — answered 400 to edits that have nothing
// to do with pricing. The check now guards a transition.
describe('PUT /api/funds/[id] — the fund-code check guards a transition, not a state', () => {
  it('lets a DCA write through on a synced fund the feed cannot price', async () => {
    h.previous = { code: 'MYSTERY', nav_auto_sync: true }
    h.priceable = false

    const res = await PUT(makeReq({
      ...baseBody, code: 'MYSTERY', nav_auto_sync: true, is_dca: true, dca_monthly_amount_vnd: 2_000_000,
    }), ctx)

    expect(res.status).toBe(200)
    expect(h.captured).toMatchObject({ dca_monthly_amount_vnd: 2_000_000 })
  })

  it('still refuses to switch pricing on for a code the feed cannot price', async () => {
    h.previous = { code: 'MYSTERY', nav_auto_sync: false }
    h.priceable = false

    const res = await PUT(makeReq({ ...baseBody, code: 'MYSTERY', nav_auto_sync: true }), ctx)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/MYSTERY/)
    expect(h.captured).toBeNull()
  })
})
