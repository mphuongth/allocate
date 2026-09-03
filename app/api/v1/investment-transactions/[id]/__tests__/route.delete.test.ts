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

  // The mirror image of the guard. Two columns reference this table with no
  // ON DELETE action, so deleting a deposit that either points at raises 23503 —
  // a conflict the caller has to resolve differently in each case, so one
  // catch-all message would misdirect half of them. The wording says what IS the
  // case rather than prescribing an undo — there is no unmerge route or UI, so
  // "undo the merge first" pointed at an action nobody can perform (#550).
  it('returns 409 naming the merge when a consumed settlement references the row', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint "investment_transactions_consumed_by_inv_id_fkey"' },
    }
    const res = await call()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('merge_target')
    expect(body.error).toMatch(/merged into this deposit/i)
    // Must not converge with the pending-settlement wording, which is a
    // different situation with a different (and actually available) remedy.
    expect(body.error).not.toMatch(/waiting|pending/i)
  })

  // merge_anchor_inv_id is stamped when a settlement is HELD — before any merge
  // happens. Telling this caller to undo a merge sends them looking for
  // something that doesn't exist; the fix is to cancel the pending settlement.
  it('returns 409 naming the pending settlement when only a held one references the row', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint "investment_transactions_merge_anchor_inv_id_fkey"' },
    }
    const res = await call()
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatch(/pending|waiting/i)
    expect(error).not.toMatch(/undo the merge/i)
  })

  // parent_transaction_id is ON DELETE SET NULL, so deleting a settled deposit
  // would null its settlement's only link back to what it closed (#588). The
  // database refuses that, and the refusal arrives as a check violation — not the
  // 23503 this handler was built around, so without its own branch an ordinary
  // ledger action reads as a server fault.
  it('returns 409 when a settlement is still parked against the deposit', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23514', message: 'held settlement: this deposit has a settlement parked against it — remove that settlement first' },
    }

    const res = await call()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('held_settlement_parked')
    expect(body.error).toMatch(/settlement/i)
  })

  // A renewal — and a book collapse — rolls the SAME row forward and appends a
  // history snapshot pointing back at it, so the row Recent Activity shows dated
  // "the day I renewed" IS the deposit. Deleting it removes the holding and, via
  // ON DELETE SET NULL, hands every snapshot back as a live holding of a closed
  // cycle. The database refuses it; this maps the refusal to something the user
  // can act on, because 500 would call an ordinary ledger click a server fault.
  it('returns 409 when the deposit still carries renewal history', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23514', message: 'renewal history: deposit has 5 closed cycle(s) recorded against it' },
    }

    const res = await call()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('renewal_history')
    expect(body.error).toMatch(/history/i)
  })

  // Deleting a holding that a withdrawal still draws on is refused by the source
  // side of the withdrawal invariant (#608): the cash would be left filed under no
  // holding, which is silent and permanent. Like the settlement above it arrives as
  // a check violation rather than the 23503 this handler was built around, so
  // without its own branch an ordinary conflict reads as a server fault.
  it('returns 409 when a withdrawal still draws on the holding', async () => {
    h.deleteResult = {
      data: null,
      error: {
        code: '23514',
        message: 'withdrawal invariant: holding abc cannot be deleted while this withdrawal still draws 60000000 on it',
      },
    }

    const res = await call()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('withdrawal_invariant')
    expect(body.error).toMatch(/withdrawal/i)
    // The database's own sentence, with the row ids in it, is not the user's.
    expect(JSON.stringify(body)).not.toContain('60000000')
  })

  // A book promised to a successor is deliberately undeletable (#638) — losing
  // the plan is the failure the link exists to prevent — so the answer has to
  // say what to undo, not that the server broke.
  it('returns 409 telling the user to cancel the handover first', async () => {
    h.deleteResult = {
      data: null,
      error: {
        code: '23514',
        message: 'successor book: this book is promised to a successor, so cancel the handover before deleting it',
      },
    }

    const res = await call()

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('successor_planned')
    expect(body.error).toMatch(/cancel the handover/i)
  })

  it('returns a generic 409 for an unrecognised foreign-key reference', async () => {
    h.deleteResult = {
      data: null,
      error: { code: '23503', message: 'violates foreign key constraint "some_future_fkey"' },
    }
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBeTruthy()
  })

  it('does not leak the database message to the client', async () => {
    h.deleteResult = { data: null, error: { message: 'relation "x" does not exist' } }
    const res = await call()
    expect(JSON.stringify(await res.json())).not.toContain('does not exist')
  })
})
