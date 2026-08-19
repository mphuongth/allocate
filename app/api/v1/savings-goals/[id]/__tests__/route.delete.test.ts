import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Guard for #687. The DELETE used to be four separate requests — count, check for
// parked cash, clear dead merge targets, delete — with the errors of the first
// and third dropped. Between the third and the fourth the cleanup could commit
// while the delete failed, leaving consumed merge history stripped of the target
// it recorded and the goal still there.
//
// The whole transition now happens inside delete_savings_goal, so what is left
// to test here is the mapping: the route authenticates, validates, calls the RPC
// once, and turns each refusal into the answer the user gets.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  result: { data: null as unknown, error: null as { message?: string } | null },
  tables: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (fn: string, args: unknown) => {
      h.rpcCalls.push({ fn, args })
      return h.result
    },
    // Any direct table work would be a step back outside the transaction.
    from: (table: string) => {
      h.tables.push(table)
      throw new Error(`unexpected table access: ${table}`)
    },
  }),
}))

const { DELETE } = await import('../route')

const ID = '33333333-3333-4333-8333-333333333333'

const del = (id: string = ID) =>
  DELETE(new Request(`https://app.test/api/v1/savings-goals/${id}`, { method: 'DELETE' }) as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  })

describe('DELETE /api/v1/savings-goals/[id] (#687)', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.rpcCalls = []
    h.tables = []
    h.result = { data: { moved: 2 }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('does the whole delete in one RPC call, touching no table directly', () => {
    return del().then(async (res) => {
      expect(res.status).toBe(200)
      expect(h.rpcCalls).toEqual([{ fn: 'delete_savings_goal', args: { p_goal_id: ID } }])
      expect(h.tables).toEqual([])
    })
  })

  it('reports the count the transaction itself produced', async () => {
    const res = await del()

    await expect(res.json()).resolves.toEqual({
      message: 'Goal deleted. 2 transactions moved to Unassigned Investments.',
    })
  })

  it('says "transaction" in the singular for exactly one', async () => {
    h.result = { data: { moved: 1 }, error: null }

    const res = await del()

    await expect(res.json()).resolves.toEqual({
      message: 'Goal deleted. 1 transaction moved to Unassigned Investments.',
    })
  })

  it('handles a goal with nothing linked to it', async () => {
    h.result = { data: { moved: 0 }, error: null }

    const res = await del()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      message: 'Goal deleted. 0 transactions moved to Unassigned Investments.',
    })
  })

  it('maps parked cash to 409 with the code the sheet acts on', async () => {
    h.result = {
      data: null,
      error: { message: 'delete goal: this goal has cash parked in it for a merge (abc)' },
    }

    const res = await del()

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'This goal has cash parked in it for a merge. Release that settlement before deleting the goal.',
      code: 'held_settlement_parked',
    })
  })

  it('maps a goal that is not there — or not the caller\'s — to 404', async () => {
    // RLS scopes the RPC, so a foreign goal is invisible and answers exactly as a
    // goal that never existed does. Nothing leaks.
    h.result = { data: null, error: { message: 'delete goal: goal not found' } }

    const res = await del()

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Goal not found' })
  })

  it('does not report an unexpected database failure as a missing goal', async () => {
    // The old route answered 404 for every error, so a deadlock or a permission
    // fault read as "that goal does not exist" — the error-vs-not-found
    // conflation of #532/#533.
    h.result = { data: null, error: { message: 'deadlock detected' } }

    const res = await del()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to delete the goal' })
  })

  it('returns 401 without calling the RPC', async () => {
    h.user = null

    const res = await del()

    expect(res.status).toBe(401)
    expect(h.rpcCalls).toEqual([])
  })

  it('rejects a malformed id before any database work', async () => {
    const res = await del('not-a-uuid')

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toEqual([])
  })
})
