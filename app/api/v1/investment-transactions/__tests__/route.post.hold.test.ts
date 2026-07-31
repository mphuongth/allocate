import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// A held-for-merge settlement ("Để dành gộp") closes a deposit and parks its cash;
// the dashboard adds that cash straight back into net worth and the goal bar. So
// the row's amount_vnd IS net worth, and the route used to assemble the row from
// the client's body — accepting one backed by no deposit at all, or by a deposit
// worth a thousandth of the amount claimed (#588).
//
// create_held_settlement now derives everything derivable from the SOURCE, under
// a row lock. What this file guards is the route's side of that move:
//
//   • the settlement is created by the RPC — no generic insert may reappear here,
//     because an insert is exactly the unchecked path that was the bug;
//   • the source is named, and the RPC's own refusals are translated rather than
//     swallowed or echoed raw;
//   • recurring_savings is still untouched from the route (#531 — the unlink is
//     an AFTER INSERT trigger, inside the insert's transaction).

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  ops: [] as { table: string; op: string }[],
  parent: { data: { deposit_group_id: null } as unknown, error: null as unknown },
  goal: { data: { goal_id: 'goal-1' } as unknown, error: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
  rpcResult: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      insert: () => { op = 'insert'; return c },
      update: () => { op = 'update'; return c },
      eq: () => c,
      is: () => c,
      not: () => c,
      single: async () => {
        h.ops.push({ table, op })
        if (op === 'insert') return h.insertResult
        return table === 'savings_goals' ? h.goal : h.parent
      },
      maybeSingle: async () => {
        h.ops.push({ table, op })
        return table === 'savings_goals' ? h.goal : h.parent
      },
      then: (resolve: (v: unknown) => void) => {
        h.ops.push({ table, op })
        resolve({ data: null, error: null })
      },
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args })
        return { single: async () => h.rpcResult }
      },
    }),
  }
})

const { POST } = await import('../route')

const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ANCHOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const NEW_TX_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const HELD_BODY = {
  transaction_type: 'withdrawal',
  asset_type: 'bank',
  investment_date: '2026-07-01',
  amount_vnd: 100_000_000,
  parent_transaction_id: SOURCE_ID,
  principal_withdrawn: 100_000_000,
  goal_id: GOAL_ID,
  held_for_merge: true,
  merge_target_goal_id: GOAL_ID,
  merge_anchor_inv_id: ANCHOR_ID,
}

const call = (body: Record<string, unknown> = HELD_BODY) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

describe('POST /api/v1/investment-transactions — held-for-merge settlement', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.ops = []
    h.parent = { data: { deposit_group_id: null }, error: null }
    h.goal = { data: { goal_id: GOAL_ID }, error: null }
    h.insertResult = { data: { transaction_id: NEW_TX_ID, held_for_merge: true }, error: null }
    h.rpcResult = { data: { transaction_id: NEW_TX_ID, held_for_merge: true }, error: null }
    h.rpcCalls = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates the settlement', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ transaction_id: NEW_TX_ID })
  })

  // The #588 guard. An insert here is the unchecked path: it would write
  // amount_vnd — which the dashboard turns into net worth — with no deposit
  // behind it and no bound on the number.
  it('creates it through the RPC, never a generic insert', async () => {
    await call()

    expect(h.rpcCalls.map((c) => c.fn)).toEqual(['create_held_settlement'])
    expect(h.ops.filter((o) => o.op === 'insert')).toEqual([])
  })

  it('passes the source and the received amount, and nothing the source can supply', async () => {
    await call()

    const args = h.rpcCalls[0].args
    expect(args).toMatchObject({
      p_source_id: SOURCE_ID,
      p_amount_vnd: 100_000_000,
      p_investment_date: '2026-07-01',
      p_merge_target_goal_id: GOAL_ID,
      p_merge_anchor_inv_id: ANCHOR_ID,
    })
    // principal_withdrawn is derived from the source's remaining balance. Forwarding
    // the client's number would hand back the control the RPC exists to take.
    expect(Object.keys(args)).not.toContain('p_principal_withdrawn')
  })

  // Without a source there is nothing to derive from, and nothing to bound the
  // amount against — the exact row that inflated net worth.
  it('refuses a settlement that names no deposit', async () => {
    const res = await call({ ...HELD_BODY, parent_transaction_id: undefined })

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toEqual([])
    expect(h.ops.filter((o) => o.op === 'insert')).toEqual([])
  })

  // The target defaults to the source's own goal inside the RPC, so an absent
  // goal is not the route's call to make — it still has to reach the RPC.
  it('lets the RPC resolve an absent target goal', async () => {
    await call({ ...HELD_BODY, goal_id: undefined, merge_target_goal_id: undefined })

    expect(h.rpcCalls[0].args.p_merge_target_goal_id).toBeNull()
  })

  // ── translating the RPC's refusals ──────────────────────────────────────────
  it('forwards a rule the caller broke as a 400 naming it', async () => {
    h.rpcResult = {
      data: null,
      error: { code: '23514', message: 'held settlement: 999000000 is unreasonably large for a deposit with 2000000 left' },
    }

    const res = await call()

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('held_settlement_rejected')
    expect(body.error).toMatch(/unreasonably large/)
    // The prefix is the route's marker for "ours", not something to show.
    expect(body.error).not.toMatch(/^held settlement: /)
  })

  // Pointing at another user's goal or anchor is the #474 rule, and it has to
  // answer 403 like every other cross-user reference in this API — a 400 would
  // read as "your request was malformed", which it wasn't.
  it('reports a cross-user goal or anchor as 403', async () => {
    h.rpcResult = {
      data: null,
      error: { code: '42501', message: 'held settlement: the target goal does not belong to this deposit' },
    }

    expect((await call()).status).toBe(403)
  })

  it('reports a missing (or foreign) source as 404', async () => {
    h.rpcResult = {
      data: null,
      error: { code: 'P0002', message: 'held settlement: the deposit being settled was not found' },
    }

    expect((await call()).status).toBe(404)
  })

  // Anything without the prefix is not a rule we wrote — it is a fault, and
  // echoing it would leak database internals as if it were advice.
  it('does not echo a database error it did not author', async () => {
    h.rpcResult = { data: null, error: { code: '42P01', message: 'relation "x" does not exist' } }

    const res = await call()

    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })

  it('returns 500 rather than 201 when the RPC returns no row', async () => {
    h.rpcResult = { data: null, error: null }

    expect((await call()).status).toBe(500)
  })

  // ── #531, still true ────────────────────────────────────────────────────────
  it('does not touch recurring_savings from the route', async () => {
    await call()
    expect(h.ops.filter((o) => o.table === 'recurring_savings')).toEqual([])
  })

  // A plain withdrawal never closed the source for merge, so it never had the
  // cleanup — and must not acquire one. It also must not reach the held RPC.
  it('leaves a plain withdrawal on the ordinary insert path', async () => {
    await call({ ...HELD_BODY, held_for_merge: false, merge_target_goal_id: undefined })

    expect(h.rpcCalls).toEqual([])
    expect(h.ops.filter((o) => o.table === 'recurring_savings')).toEqual([])
    expect(h.ops.filter((o) => o.op === 'insert')).toEqual([{ table: 'investment_transactions', op: 'insert' }])
  })
})
