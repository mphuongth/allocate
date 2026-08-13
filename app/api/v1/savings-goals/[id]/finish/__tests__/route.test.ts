import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// POST /api/v1/savings-goals/:id/finish — the route around the atomic RPC (#650).
//
// The liquidation itself is the database's job (supabase/tests/finish_savings_goal
// .test.sql); what is tested here is everything the route decides on its own: who
// may call it, which completion value it archives, and how each of the database's
// refusals reaches the user. A finish that fails must say WHY — "Failed to finish
// the goal" on a blocked goal sends the user hunting through their plan.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  goal: { goal_id: '', goal_name: 'New kitchen', completed_at: null as string | null } as Record<string, unknown> | null,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: {} as unknown, error: null as { message: string } | null },
  blockers: { data: [] as unknown[], error: null as { message: string } | null },
  holdings: { data: [] as unknown[], error: null as { message: string } | null },
  goalError: null as { message: string } | null,
  goldPrice: { data: { price_per_chi: 4_700_000 } as { price_per_chi: number } | null, error: null as { message: string } | null },
  fingerprint: { data: '4:2026-08-13 02:00:00+00' as unknown, error: null as { message: string } | null },
  overview: { ok: true, data: { goals: [] as Array<Record<string, unknown>> } } as unknown,
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => (table === 'gold_price_settings' ? h.goldPrice : { data: h.goalError ? null : h.goal, error: h.goalError }),
      }
      return chain
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpc.push({ fn, args })
      if (fn === 'savings_goal_finish_blockers') return h.blockers
      if (fn === 'savings_goal_live_holdings') return h.holdings
      if (fn === 'savings_goal_ledger_fingerprint') return h.fingerprint
      return h.rpcResult
    },
  }),
}))

vi.mock('@/lib/dashboardOverview', () => ({
  buildDashboardOverview: async () => h.overview,
}))

const { GET, POST } = await import('../route')

const GOAL_ID = '33333333-3333-4333-8333-333333333333'
const PLAN = [{ key: 'tx:abc', received: 1_000_000 }]

const post = (body: unknown, id: string = GOAL_ID) =>
  POST(
    new Request(`https://app.test/api/v1/savings-goals/${id}/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

const get = (id: string = GOAL_ID) =>
  GET(new Request(`https://app.test/api/v1/savings-goals/${id}/finish`) as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.goal = { goal_id: GOAL_ID, goal_name: 'New kitchen', completed_at: null }
  h.rpc = []
  h.rpcResult = { data: { realized: 30_000_000, holdings: 4, completion_value: 26_000_000 }, error: null }
  h.blockers = { data: [], error: null }
  h.holdings = { data: [], error: null }
  h.goalError = null
  h.goldPrice = { data: { price_per_chi: 4_700_000 }, error: null }
  h.fingerprint = { data: '4:2026-08-13 02:00:00+00', error: null }
  h.overview = { ok: true, data: { goals: [{ goalId: GOAL_ID, currentValue: 25_000_000, progressValue: 26_000_000 }] } }
})

describe('GET (blockers)', () => {
  it('names what still feeds the goal', async () => {
    h.blockers = { data: [{ code: 'recurring_saving', label: 'Gửi góp hàng tháng' }], error: null }
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      blockers: [{ code: 'recurring_saving', label: 'Gửi góp hàng tháng' }],
      // The authoritative holdings ride along, so the sheet never builds its
      // plan from the page's newest-200 window.
      holdings: [],
      completed: false,
    })
  })

  it('prices each holding from the dashboard valuation, not from its cost basis', async () => {
    // The sheet prefills the payout from this. A holding older than the goal
    // page's 200-row window has no other source of "what is it worth today".
    h.holdings = { data: [
      { key: 'fund:f1', kind: 'fund', asset_type: 'fund', principal: 5_000_000, units: 250, name: 'VESAF' },
      { key: 'tx:d1', kind: 'single', asset_type: 'bank', principal: 10_000_000, units: null, name: 'ACB' },
      { key: 'tx:x9', kind: 'single', asset_type: 'bank', principal: 500_000, units: null, name: 'Không định giá được' },
    ], error: null }
    h.overview = { ok: true, data: { goals: [{
      goalId: GOAL_ID, currentValue: 1, progressValue: 1,
      funds: [{ fundId: 'f1', currentValue: 6_200_000, quantity: 250 }],
      nonFunds: [{ transactionId: 'd1', currentValue: 10_400_000, units: null }],
    }] } }

    const body = await (await get()).json()
    expect(body.holdings).toEqual([
      { key: 'fund:f1', kind: 'fund', asset_type: 'fund', principal: 5_000_000, units: 250, name: 'VESAF', value: 6_200_000 },
      { key: 'tx:d1', kind: 'single', asset_type: 'bank', principal: 10_000_000, units: null, name: 'ACB', value: 10_400_000 },
      // Nothing valued it — left null rather than guessed, so the sheet falls
      // back to the cost basis and the user can correct it.
      { key: 'tx:x9', kind: 'single', asset_type: 'bank', principal: 500_000, units: null, name: 'Không định giá được', value: null },
    ])
  })

  it('hands gold over unvalued when no gold price is configured', async () => {
    // The overview values gold at its purchase cost when no price is set, which
    // reads here as a perfectly good valuation — so ask the source directly.
    h.goldPrice = { data: null, error: null }
    h.holdings = { data: [{ key: 'tx:g', kind: 'single', asset_type: 'gold', principal: 8_000_000, units: 2, name: 'Vàng' }], error: null }
    h.overview = { ok: true, data: { goals: [{
      goalId: GOAL_ID, currentValue: 8_000_000, progressValue: 8_000_000,
      funds: [], nonFunds: [{ transactionId: 'g', currentValue: 8_000_000, units: 2 }],
    }] } }
    const body = await (await get()).json()
    expect(body.holdings[0]).toMatchObject({ key: 'tx:g', value: null })
  })

  it('refuses to hand out an unvalued liquidation form', async () => {
    // Unvalued, the sheet prefills from cost basis — and a prefill is the figure
    // most users accept unchanged. A retry beats a form priced at what things
    // cost years ago.
    h.holdings = { data: [{ key: 'tx:d1', kind: 'single', asset_type: 'bank', principal: 10_000_000, units: null, name: 'ACB' }], error: null }
    h.overview = { ok: false }
    expect((await get()).status).toBe(500)
  })

  it('404s a goal that is not the caller\'s', async () => {
    h.goal = null
    expect((await get()).status).toBe(404)
  })

  it('does not report a failed lookup as a missing goal', async () => {
    // "Goal not found" during a database blip sends the user looking for
    // something that is right there, and hides a condition a retry would clear.
    h.goalError = { message: 'connection reset' }
    expect((await get()).status).toBe(500)
    expect((await post({ plan: PLAN })).status).toBe(500)
    expect(h.rpc.some((c) => c.fn === 'finish_savings_goal')).toBe(false)
  })
})

describe('POST', () => {
  it('archives at the goal\'s PROGRESS value, not the cash the liquidation raised', async () => {
    // A goal partly spent before it was finished has already released value
    // through affects_progress=false withdrawals. Archiving the realized cash
    // would record it as having achieved less than it did.
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(200)
    expect(h.rpc.find((c) => c.fn === 'finish_savings_goal')?.args.p_completion_value).toBe(26_000_000)
    expect(await res.json()).toMatchObject({ realized: 30_000_000, holdings: 4, completionPercentage: 100 })
  })

  it('reads the ledger fingerprint BEFORE valuing the goal, and hands it to the finish', async () => {
    // Anything landing in the ledger after this read invalidates the value about
    // to be computed, and the RPC re-reads it under the goal's lock. Taken first
    // so the check is over-strict rather than under-strict.
    await post({ plan: PLAN })
    expect(h.rpc.map((c) => c.fn)).toEqual(['savings_goal_ledger_fingerprint', 'finish_savings_goal'])
    expect(h.rpc[1].args.p_ledger_fingerprint).toBe('4:2026-08-13 02:00:00+00')
  })

  it('does not archive a snapshot it could not anchor to a ledger', async () => {
    h.fingerprint = { data: null, error: { message: 'boom' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(500)
    expect(h.rpc.some((c) => c.fn === 'finish_savings_goal')).toBe(false)
  })

  it('falls back to the current value when the goal has no progress figure', async () => {
    h.overview = { ok: true, data: { goals: [{ goalId: GOAL_ID, currentValue: 25_000_000 }] } }
    await post({ plan: PLAN })
    expect(h.rpc.find((c) => c.fn === 'finish_savings_goal')?.args.p_completion_value).toBe(25_000_000)
  })

  it('passes the plan through as sent, rounded to the đồng', async () => {
    await post({ plan: [{ key: 'tx:abc', received: 1_000_000.6 }] })
    expect(h.rpc.find((c) => c.fn === 'finish_savings_goal')?.args.p_plan)
      .toEqual([{ key: 'tx:abc', received: 1_000_001 }])
  })

  it('rejects an unauthenticated caller before touching the ledger', async () => {
    h.user = null
    expect((await post({ plan: PLAN })).status).toBe(401)
    expect(h.rpc).toHaveLength(0)
  })

  it('rejects a plan that is not an array', async () => {
    const res = await post({ plan: 'everything' })
    expect(res.status).toBe(400)
    expect(h.rpc).toHaveLength(0)
  })

  it('rejects an amount too large for the BIGINT column instead of 500ing on the cast', async () => {
    // 1e30 is finite, rounds happily, and then overflows inside the transaction.
    const res = await post({ plan: [{ key: 'tx:abc', received: 1e30 }] })
    expect(res.status).toBe(400)
    expect(h.rpc).toHaveLength(0)
  })

  it('rejects a realization the ledger cannot record', async () => {
    // amount_vnd must be positive — a zero or negative would be refused by the
    // table mid-finish and roll everything back behind a generic error.
    for (const received of [-1, 0]) {
      const res = await post({ plan: [{ key: 'tx:abc', received }] })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('positive')
    }
    expect(h.rpc).toHaveLength(0)
  })

  it('refuses to finish an already-completed goal', async () => {
    h.goal = { goal_id: GOAL_ID, goal_name: 'New kitchen', completed_at: '2026-08-01T00:00:00Z' }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('already_completed')
    expect(h.rpc).toHaveLength(0)
  })

  it('says which kind of thing still feeds the goal', async () => {
    h.rpcResult = { data: null, error: { message: 'finish goal blocked: dca_plan VESAF' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('blocked_dca_plan')
    expect(body.blocker).toBe('dca_plan VESAF')
  })

  it('tells the user to reload when the plan no longer matches the goal', async () => {
    h.rpcResult = { data: null, error: { message: 'finish goal: the liquidation plan leaves holding tx:x unrealized' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('stale_plan')
    expect(body.error).toBe('the liquidation plan leaves holding tx:x unrealized')
  })

  it('reports a refused withdrawal as a change that did not happen', async () => {
    h.rpcResult = { data: null, error: { message: 'withdrawal invariant: 5 exceeds the remaining balance of 3 on this holding' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('liquidation_refused')
    expect(body.error).toContain('nothing was changed')
  })

  it('names a book shared with another goal, and does not call it a stale page', async () => {
    h.rpcResult = { data: null, error: { message: 'split book: Tích luỹ chung has tranches in another goal, so it cannot be closed by finishing this one — move the whole book into one goal first' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('book_split')
    expect(body.error).toMatch(/^Tích luỹ chung has tranches in another goal/)
  })

  it('names a promised handover rather than reporting a server fault', async () => {
    h.rpcResult = { data: null, error: { message: 'successor book: this book is promised to a successor, so cancel the handover before closing it' } }
    const res = await post({ plan: PLAN })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('successor_planned')
  })
})
