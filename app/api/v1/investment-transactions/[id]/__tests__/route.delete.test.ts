import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'

// A merge folds a source deposit's cash into an anchor and closes the source
// with a withdrawal stamped consumed_by_inv_id. Deleting that withdrawal
// re-opens the source at full value while its cash still sits in the anchor —
// the money is then counted twice in net worth.
//
// The guard existed, but as a SELECT followed by a separate DELETE (#526):
//
//   • the SELECT's error was discarded, so a failed guard read fell straight
//     through to the DELETE — the one path where the guard mattered most;
//   • a merge committing between the two statements was not seen by the DELETE,
//     so the check passed against a row that was consumed a moment later.
//
// The fix folds the condition into the DELETE's own WHERE clause, so there is no
// window at all: Postgres re-evaluates the predicate against the committed row.
// These tests assert that structurally — the delete must be the FIRST database
// operation, carrying the guard with it — not just that the status codes match.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  ops: [] as { op: string; filters: Record<string, unknown> }[],
  deleteResult: { data: [] as unknown[] | null, error: null as unknown },
  classifyResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = () => {
    const filters: Record<string, unknown> = {}
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      delete: () => { op = 'delete'; return c },
      eq: (col: string, val: unknown) => { filters[col] = val; return c },
      is: (col: string, val: unknown) => { filters[`${col}:is`] = val; return c },
      not: (col: string, o: string, val: unknown) => { filters[`${col}:not.${o}`] = val; return c },
      maybeSingle: async () => {
        h.ops.push({ op, filters })
        return h.classifyResult
      },
      single: async () => {
        h.ops.push({ op, filters })
        return h.classifyResult
      },
      then: (resolve: (v: unknown) => void) => {
        h.ops.push({ op, filters })
        resolve(op === 'delete' ? h.deleteResult : h.classifyResult)
      },
    }
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chain(),
    }),
  }
})

const { DELETE } = await import('../route')

const TX_ID = '88888888-8888-4888-8888-888888888888'
const ANCHOR_ID = '99999999-9999-4999-8999-999999999999'

const call = (id = TX_ID) =>
  DELETE(new Request(`https://app.test/api/v1/investment-transactions/${id}`) as unknown as NextRequest, {
    params: Promise.resolve({ id }),
  })

describe('DELETE /api/v1/investment-transactions/[id]', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.ops = []
    h.deleteResult = { data: [{ transaction_id: TX_ID }], error: null }
    h.classifyResult = { data: null, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null
    expect((await call()).status).toBe(401)
    expect(h.ops).toEqual([])
  })

  it('returns 400 for a malformed transaction id', async () => {
    expect((await call('not-a-uuid')).status).toBe(400)
    expect(h.ops).toEqual([])
  })

  it('deletes an unconsumed transaction', async () => {
    const res = await call()
    expect(res.status).toBe(200)
  })

  // ── the atomicity guarantee ──────────────────────────────────────────────────
  it('makes the delete the first database operation, with no guard read before it', async () => {
    await call()
    expect(h.ops[0].op).toBe('delete')
  })

  it('carries the consumed guard inside the delete statement', async () => {
    await call()
    const del = h.ops.find((o) => o.op === 'delete')!
    expect(del.filters['consumed_by_inv_id:is']).toBeNull()
    expect(del.filters.transaction_id).toBe(TX_ID)
    expect(del.filters.user_id).toBe('user-1')
  })

  // ── classifying a delete that matched nothing ────────────────────────────────
  it('returns 409 when the row survives because it was already merged', async () => {
    h.deleteResult = { data: [], error: null }
    h.classifyResult = { data: { consumed_by_inv_id: ANCHOR_ID }, error: null }
    const res = await call()
    expect(res.status).toBe(409)
  })

  it('returns 404 when the transaction does not exist', async () => {
    h.deleteResult = { data: [], error: null }
    h.classifyResult = { data: null, error: null }
    expect((await call()).status).toBe(404)
  })

  // ── failing closed ───────────────────────────────────────────────────────────
  it('returns 500 when the delete itself errors, never a success', async () => {
    h.deleteResult = { data: null, error: { message: 'deadlock detected' } }
    const res = await call()
    expect(res.status).toBe(500)
  })

  // Guessing 404 here would tell the client the settlement is gone when it may
  // still be there; guessing 409 would block a legitimate delete.
  it('returns 500 when the follow-up classification read errors', async () => {
    h.deleteResult = { data: [], error: null }
    h.classifyResult = { data: null, error: { message: 'timeout' } }
    expect((await call()).status).toBe(500)
  })

  // The mirror image of the guard. consumed_by_inv_id has no ON DELETE action,
  // so deleting the ANCHOR while a consumed source still points at it raises a
  // foreign-key violation. That is a conflict with existing data the user can
  // resolve (undo the merge first), not a server fault — it must not read as a
  // generic 500.
  it('returns 409 when the row is still referenced by a merged settlement', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint "investment_transactions_consumed_by_inv_id_fkey"' },
    }
    const res = await call()
    expect(res.status).toBe(409)
  })

  it('does not leak the database message to the client', async () => {
    h.deleteResult = { data: null, error: { message: 'relation "x" does not exist' } }
    const res = await call()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
