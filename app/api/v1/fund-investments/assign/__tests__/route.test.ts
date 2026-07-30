import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// Assigning a fund row moves EVERY fund-investment behind that row, and the
// client used to do it by listing the fund and PATCHing each id in a Promise.all
// (#589). Two bugs in one: the list was unscoped, so assigning the *Unallocated*
// row also dragged rows that belonged to another goal, and a partial failure left
// the fund split across goals with no row in the UI to repair it from.
//
// This route is the replacement primitive: one UPDATE statement — hence one
// transaction, all-or-nothing — that moves the fund's rows from ONE goal bucket
// to another. `from_goal_id: null` is the Unallocated bucket, which is what the
// assign flow uses; `to_goal_id: null` unassigns, which is what goal detail uses.
//
// What the filter chain contains is the whole fix, so the mock records it.

type Filter = { table: string; kind: string; args: unknown[] }

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  goal: { data: null as unknown, error: null as unknown },
  updated: { data: [] as unknown[] | null, error: null as unknown },
  update: null as unknown,
  filters: [] as Filter[],
  tables: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      update: (payload: unknown) => { h.update = payload; return c },
      eq: (...args: unknown[]) => { h.filters.push({ table, kind: 'eq', args }); return c },
      is: (...args: unknown[]) => { h.filters.push({ table, kind: 'is', args }); return c },
      or: (...args: unknown[]) => { h.filters.push({ table, kind: 'or', args }); return c },
      single: async () => h.goal,
      // `.update(...).select()` is awaited directly — it resolves to the rows the
      // statement actually touched, which is how the route counts the move.
      then: (resolve: (v: unknown) => void) => resolve(h.updated),
    }
    h.tables.push(table)
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

// Only the UPDATE's own filters — the goal ownership lookup filters by goal_id too.
const filter = (kind: string, col: string) => {
  const found = h.filters.find((f) =>
    f.table === 'investment_transactions' && f.kind === kind && f.args[0] === col)
  return found ? { kind: found.kind, args: found.args } : undefined
}

describe('POST /api/v1/fund-investments/assign', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.goal = { data: { goal_id: GOAL_A }, error: null }
    h.updated = { data: [{ transaction_id: TX_1 }, { transaction_id: TX_2 }], error: null }
    h.update = null
    h.filters = []
    h.tables = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('moves the fund from Unallocated to the goal and reports how many rows moved', async () => {
    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ moved: 2 })
    expect(h.update).toMatchObject({ goal_id: GOAL_A })
  })

  // The #589 bug: without this the UPDATE spans every goal's rows for the fund.
  it('scopes the move to the source bucket — Unallocated means goal_id IS NULL', async () => {
    await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(filter('is', 'goal_id')).toEqual({ kind: 'is', args: ['goal_id', null] })
    // No eq on goal_id as well — that would contradict the IS NULL scope.
    expect(filter('eq', 'goal_id')).toBeUndefined()
  })

  it('scopes an unassign to the goal it is leaving', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: null })

    expect(filter('eq', 'goal_id')).toEqual({ kind: 'eq', args: ['goal_id', GOAL_A] })
    expect(filter('is', 'goal_id')).toBeUndefined()
    expect(h.update).toMatchObject({ goal_id: null })
  })

  it('scopes a goal-to-goal move to the source goal', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: GOAL_B })

    expect(filter('eq', 'goal_id')).toEqual({ kind: 'eq', args: ['goal_id', GOAL_A] })
    expect(h.update).toMatchObject({ goal_id: GOAL_B })
  })

  it('restricts the move to the caller, the fund, and fund rows', async () => {
    await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(filter('eq', 'user_id')).toEqual({ kind: 'eq', args: ['user_id', 'user-1'] })
    expect(filter('eq', 'fund_id')).toEqual({ kind: 'eq', args: ['fund_id', FUND] })
    expect(filter('eq', 'asset_type')).toEqual({ kind: 'eq', args: ['asset_type', 'fund'] })
  })

  // Pending DCA seeds (is_dca_seeded with no units) are not holdings: the fund
  // list excludes them and the dashboard never values them, so the old client
  // path never moved them. Same filter here keeps that behaviour.
  it('leaves pending DCA seed rows where they are', async () => {
    await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(filter('or', 'is_dca_seeded.eq.false,units.not.is.null')).toBeTruthy()
  })

  it('rejects a goal the caller does not own', async () => {
    h.goal = { data: null, error: null }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(403)
    // Nothing was written.
    expect(h.update).toBeNull()
  })

  it('does not need a goal lookup when unassigning', async () => {
    await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: null })

    expect(h.tables).toEqual(['investment_transactions'])
  })

  // The row is on screen, so rows were expected. Zero moved means something else
  // moved them first — the caller has to be told rather than shown a success it
  // can't see the result of.
  it('reports a conflict when nothing was left to move', async () => {
    h.updated = { data: [], error: null }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'no_rows_moved' })
  })

  it('rejects a move whose source and target are the same bucket', async () => {
    const res = await call({ fund_id: FUND, from_goal_id: GOAL_A, to_goal_id: GOAL_A })

    expect(res.status).toBe(400)
    expect(h.update).toBeNull()
  })

  it('rejects a missing or malformed fund id', async () => {
    expect((await call({ to_goal_id: GOAL_A })).status).toBe(400)
    expect((await call({ fund_id: 'not-a-uuid', to_goal_id: GOAL_A })).status).toBe(400)
    expect((await call({ fund_id: FUND, from_goal_id: 'not-a-uuid', to_goal_id: null })).status).toBe(400)
    expect(h.update).toBeNull()
  })

  it('requires a session', async () => {
    h.user = null

    expect((await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })).status).toBe(401)
    expect(h.update).toBeNull()
  })

  it('reports a failed update instead of a silent success', async () => {
    h.updated = { data: null, error: { message: 'deadlock detected' } }

    const res = await call({ fund_id: FUND, from_goal_id: null, to_goal_id: GOAL_A })

    expect(res.status).toBe(500)
  })
})
