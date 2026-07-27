import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Creating a held-for-merge settlement closes its source deposit, so a recurring
// saving still pointing at that source has to be unlinked at the same moment.
//
// The route did that as a second statement after the insert, discarded its
// result, and returned 201 either way (#531) — a failed cleanup left a dangling
// link behind a success response. It now happens inside the insert's own
// transaction, via an AFTER INSERT trigger
// (supabase/migrations/20260727000003), whose rollback behaviour is pinned by
// supabase/tests/hold_clears_recurring_link.test.sql against a real database.
//
// What this file guards is the route's side of that move: it must no longer
// touch recurring_savings at all. A fire-and-forget UPDATE reappearing here
// would silently restore the split — and, being fire-and-forget, would look like
// it was working.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  ops: [] as { table: string; op: string }[],
  parent: { data: { deposit_group_id: null } as unknown, error: null as unknown },
  goal: { data: { goal_id: 'goal-1' } as unknown, error: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
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
    }),
  }
})

const { POST } = await import('../route')

const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
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

  // The regression guard: the unlink is the database's job now.
  it('does not touch recurring_savings from the route', async () => {
    await call()
    expect(h.ops.filter((o) => o.table === 'recurring_savings')).toEqual([])
  })

  it('issues exactly one write, the settlement insert', async () => {
    await call()
    const writes = h.ops.filter((o) => o.op === 'insert' || o.op === 'update')
    expect(writes).toEqual([{ table: 'investment_transactions', op: 'insert' }])
  })

  // If the trigger's cleanup fails, the insert fails with it — the route must
  // report that rather than the 201 the old fire-and-forget path returned.
  it('returns 500 rather than 201 when the insert (and its cleanup) fails', async () => {
    h.insertResult = { data: null, error: { message: 'forced cleanup failure' } }
    const res = await call()
    expect(res.status).toBe(500)
  })

  it('still rejects a held settlement with no resolvable target goal', async () => {
    const res = await call({ ...HELD_BODY, goal_id: undefined, merge_target_goal_id: undefined })
    expect(res.status).toBe(400)
    expect(h.ops.filter((o) => o.op === 'insert')).toEqual([])
  })

  // A plain withdrawal never closed the source for merge, so it never had the
  // cleanup — and must not acquire one.
  it('does not touch recurring_savings for a plain withdrawal either', async () => {
    await call({ ...HELD_BODY, held_for_merge: false, merge_target_goal_id: undefined })
    expect(h.ops.filter((o) => o.table === 'recurring_savings')).toEqual([])
  })
})
