import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Assigning a fund row moves EVERY fund-investment behind that row, and the
// client used to do it by listing the fund and PATCHing each id in a Promise.all
// (#589). Two bugs in one: the list was unscoped, so assigning the *Unallocated*
// row also dragged rows that belonged to another goal, and a partial failure left
// the fund split across goals with no row in the UI to repair it from.
//
// This route is the replacement primitive: one statement — hence one transaction,
// all-or-nothing — that moves the fund's rows from ONE goal bucket to another.
// `from_goal_id: null` is the Unallocated bucket, which is what the assign flow
// uses; `to_goal_id: null` unassigns, which is what goal detail uses.
//
// That statement is now assign_fund_bucket (#610), because the move has to hold
// the row locks a concurrent sell of the bucket takes and a lock lives as long as
// its transaction — so it cannot be split across two round trips from here. What
// this route still owns, and what these tests cover: the shape of the request, the
// bucket the RPC is asked to move, the 403 on a goal the caller does not own, and
// the answer it gives when the database says the bucket was contended. The scoping
// of the move itself is the function's, and is covered in
// supabase/tests/fund_bucket_assign.test.sql.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  goal: { data: null as unknown, error: null as unknown },
  moved: { data: [] as unknown, error: null as { code?: string; message: string } | null },
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  tables: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      single: async () => h.goal,
      // The archived-goal guard (#650) reads the same row through maybeSingle.
      maybeSingle: async () => h.goal,
    }
    h.tables.push(table)
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        h.rpc.push({ fn, args })
        return h.moved
      },
    }),
  }
})

const { POST } = await import('../route')

const FUND = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const GOAL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const GOAL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TX_1 = '11111111-1111-4111-8111-111111111111'
const TX_2 = '22222222-2222-4222-8222-222222222222'

const call = (body: unknown) =>
  POST(new NextRequest('https://app.test/api/v1/fund-investments/assign', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const move = () => h.rpc.find((r) => r.fn === 'assign_fund_bucket')

describe('POST /api/v1/fund-investments/assign', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.goal = { data: { goal_id: GOAL_A }, error: null }
    h.moved = { data: [TX_1, TX_2], error: null }
    h.rpc = []
    h.tables = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('moves the fund from Unallocated to the goal and reports how many rows moved', async () => {
    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      moved: 2,
      transaction_ids: [TX_1, TX_2],
    })
  })

  // The #589 bug: without a source bucket the move spans every goal's rows for
  // the fund. Unallocated is null, and the function matches it with IS NOT
  // DISTINCT FROM — so null is a scope here, never "no filter".
  it('scopes the move to the source bucket — Unallocated is a null source', async () => {
    await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(move()!.args).toEqual({
      p_fund_id: FUND,
      p_from_goal_id: null,
      p_to_goal_id: GOAL_A,
    })
  })

  it('scopes an unassign to the goal it is leaving', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: null })

    expect(move()!.args).toMatchObject({ p_from_goal_id: GOAL_A, p_to_goal_id: null })
  })

  it('scopes a goal-to-goal move to the source goal', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: GOAL_B })

    expect(move()!.args).toMatchObject({ p_from_goal_id: GOAL_A, p_to_goal_id: GOAL_B })
  })

  it('rejects a goal the caller does not own', async () => {
    h.goal = { data: null, error: null }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(403)
    // Nothing was written.
    expect(move()).toBeUndefined()
  })

  it('does not need a goal lookup when unassigning', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: null })

    expect(h.tables).toEqual([])
  })

  // The row is on screen, so rows were expected. Zero moved means something else
  // moved them first — the caller has to be told rather than shown a success it
  // can't see the result of.
  it('reports a conflict when nothing was left to move', async () => {
    h.moved = { data: [], error: null }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'no_rows_moved' })
  })

  it('rejects a move whose source and target are the same bucket', async () => {
    const res = await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: GOAL_A })

    expect(res.status).toBe(400)
    expect(move()).toBeUndefined()
  })

  it('rejects a missing or malformed fund id', async () => {
    expect((await call({ to_goal_id: GOAL_A })).status).toBe(400)
    expect((await call({ fund_id: 'not-a-uuid', to_goal_id: GOAL_A })).status).toBe(400)
    expect((await call({ fund_id: FUND, from_goal_id: 'not-a-uuid', to_goal_id: null })).status).toBe(400)
    expect(move()).toBeUndefined()
  })

  it('requires a session', async () => {
    h.user = null

    expect((await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })).status).toBe(401)
    expect(move()).toBeUndefined()
  })

  // Contention is not a failure: two writers reached the same bucket, Postgres
  // aborted one, nothing was written and nothing is wrong with the request. A 500
  // reads as a bug and tells the client nothing it can act on (#610).
  it.each([
    ['40P01', 'deadlock detected'],
    ['55P03', 'could not obtain lock on row'],
    ['40001', 'could not serialize access'],
  ])('answers %s with a retryable conflict', async (code, message) => {
    h.moved = { data: null, error: { code, message } }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'bucket_busy' })
  })

  it('reports a genuine failure instead of a silent success', async () => {
    h.moved = { data: null, error: { code: '23514', message: 'withdrawal invariant' } }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(500)
  })
})
