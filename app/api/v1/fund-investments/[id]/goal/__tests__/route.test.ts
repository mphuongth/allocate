import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// PATCH /fund-investments/[id]/goal is the last legacy mutation still reachable:
// it re-buckets a single fund transaction. It used to update on transaction_id +
// user_id alone (#586), which made it a generic goal writer for ANY holding:
//
//   • a bank deposit's id moved that deposit between goals through a
//     fund-scoped endpoint, bypassing the canonical route's checks;
//   • an accumulating book tranche was moved on its own, splitting the book —
//     goal is book-level and must cascade to every tranche at once;
//   • the target goal was written without an ownership check, so a known
//     foreign goal id could be stamped onto the caller's row (#474).
//
// The fixes, in the order the tests assert them: the row must be a fund, the
// goal must be the caller's, and a row that somehow carries a deposit_group_id
// goes through update_deposit_book — the same atomic RPC the canonical PUT uses
// — instead of a lone-row update.

type Filter = { table: string; kind: string; args: unknown[] }

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  existing: { data: null as unknown, error: null as unknown },
  goal: { data: null as unknown, error: null as unknown },
  updated: { data: null as unknown, error: null as unknown },
  rpc: { data: null as unknown, error: null as unknown },
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  update: null as unknown,
  filters: [] as Filter[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      update: (payload: unknown) => { h.update = payload; op = 'update'; return c },
      eq: (...args: unknown[]) => { h.filters.push({ table, kind: 'eq', args }); return c },
      is: (...args: unknown[]) => { h.filters.push({ table, kind: 'is', args }); return c },
      maybeSingle: async () => (op === 'update' ? h.updated : table === 'savings_goals' ? h.goal : h.existing),
      single: async () => (op === 'update' ? h.updated : table === 'savings_goals' ? h.goal : h.existing),
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.rpcCalls.push({ fn, args })
        return { single: async () => h.rpc }
      },
    }),
  }
})

const { PATCH } = await import('../route')

const TX = '11111111-1111-4111-8111-111111111111'
const GOAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOOK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const call = (body: unknown, id = TX) =>
  PATCH(
    new NextRequest(`https://app.test/api/v1/fund-investments/${id}/goal`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )

const filter = (kind: string, col: string) =>
  h.filters.find((f) => f.table === 'investment_transactions' && f.kind === kind && f.args[0] === col)

describe('PATCH /api/v1/fund-investments/[id]/goal', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.existing = { data: { transaction_id: TX, asset_type: 'fund', deposit_group_id: null }, error: null }
    h.goal = { data: { goal_id: GOAL }, error: null }
    h.updated = { data: { transaction_id: TX, goal_id: GOAL }, error: null }
    h.rpc = { data: { transaction_id: TX, goal_id: GOAL }, error: null }
    h.rpcCalls = []
    h.update = null
    h.filters = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('assigns a fund transaction to the goal', async () => {
    const res = await call({ goal_id: GOAL })

    expect(res.status).toBe(200)
    expect(h.update).toMatchObject({ goal_id: GOAL })
  })

  it('unassigns when goal_id is null', async () => {
    h.updated = { data: { transaction_id: TX, goal_id: null }, error: null }

    const res = await call({ goal_id: null })

    expect(res.status).toBe(200)
    expect(h.update).toMatchObject({ goal_id: null })
  })

  // ── asset type ─────────────────────────────────────────────────────────────
  // The endpoint is fund-scoped; a bank/stock/gold id is simply not a resource
  // it addresses, so it reads as absent rather than forbidden.
  it('refuses a transaction id that is not a fund holding', async () => {
    h.existing = { data: { transaction_id: TX, asset_type: 'bank', deposit_group_id: null }, error: null }

    const res = await call({ goal_id: GOAL })

    expect(res.status).toBe(404)
    expect(h.update).toBeNull()
  })

  // The pre-read is a classifier, not the guard: asset_type could change between
  // the read and the write. The UPDATE has to carry the condition itself so
  // Postgres re-evaluates it against the committed row.
  it('carries the fund condition inside the update statement', async () => {
    await call({ goal_id: GOAL })

    expect(filter('eq', 'asset_type')).toMatchObject({ args: ['asset_type', 'fund'] })
    expect(filter('eq', 'transaction_id')).toMatchObject({ args: ['transaction_id', TX] })
    expect(filter('eq', 'user_id')).toMatchObject({ args: ['user_id', 'user-1'] })
  })

  it('returns 404 when the update matches nothing', async () => {
    h.updated = { data: null, error: { message: 'no rows' } }

    expect((await call({ goal_id: GOAL })).status).toBe(404)
  })

  // ── goal ownership ─────────────────────────────────────────────────────────
  it('rejects a goal the caller does not own', async () => {
    h.goal = { data: null, error: null }

    const res = await call({ goal_id: GOAL })

    expect(res.status).toBe(403)
    expect(h.update).toBeNull()
  })

  it('does not look up a goal when unassigning', async () => {
    await call({ goal_id: null })

    expect(h.filters.some((f) => f.table === 'savings_goals')).toBe(false)
  })

  // ── accumulating book ──────────────────────────────────────────────────────
  // goal_id is book-level: every tranche of a book shares it. Updating one row
  // splits the book across two goals, and the halves can no longer be repaired
  // from the UI. The canonical PUT routes books through update_deposit_book, a
  // single-transaction cascade — so does this endpoint.
  it('cascades a book tranche through the atomic RPC instead of updating one row', async () => {
    h.existing = { data: { transaction_id: TX, asset_type: 'fund', deposit_group_id: BOOK }, error: null }

    const res = await call({ goal_id: GOAL })

    expect(res.status).toBe(200)
    expect(h.update).toBeNull()
    expect(h.rpcCalls).toHaveLength(1)
    expect(h.rpcCalls[0].fn).toBe('update_deposit_book')
    expect(h.rpcCalls[0].args).toMatchObject({ p_tx_id: TX, p_set_goal: true, p_goal_id: GOAL })
    // Only the goal moves — every other book field must be left alone.
    expect(h.rpcCalls[0].args).toMatchObject({
      p_set_expiry: false, p_set_amount: false, p_set_rate: false,
      p_set_investment: false, p_set_notes: false, p_set_bank: false,
    })
  })

  it('reports a failed cascade instead of a silent success', async () => {
    h.existing = { data: { transaction_id: TX, asset_type: 'fund', deposit_group_id: BOOK }, error: null }
    h.rpc = { data: null, error: { message: 'deadlock detected' } }

    expect((await call({ goal_id: GOAL })).status).toBe(500)
  })

  it('does not fall back to a lone-row update when the cascade fails', async () => {
    h.existing = { data: { transaction_id: TX, asset_type: 'fund', deposit_group_id: BOOK }, error: null }
    h.rpc = { data: null, error: { message: 'deadlock detected' } }

    await call({ goal_id: GOAL })

    expect(h.update).toBeNull()
  })

  // ── the ordinary refusals ──────────────────────────────────────────────────
  it('returns 404 when the transaction is not the caller’s', async () => {
    h.existing = { data: null, error: null }

    const res = await call({ goal_id: GOAL })

    expect(res.status).toBe(404)
    expect(h.update).toBeNull()
  })

  it('requires a session', async () => {
    h.user = null

    expect((await call({ goal_id: GOAL })).status).toBe(401)
    expect(h.update).toBeNull()
  })

  it('rejects malformed ids', async () => {
    expect((await call({ goal_id: GOAL }, 'not-a-uuid')).status).toBe(400)
    expect((await call({ goal_id: 'not-a-uuid' })).status).toBe(400)
    expect(h.update).toBeNull()
  })
})
