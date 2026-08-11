import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Keeping the promise (#638, Phase 3). The route is thin: the coupled writes all
// live in merge_book_into_successor. What it owes is validation, naming the
// tranches it saw so a book that changed underneath can be refused, and turning
// the RPC's refusals into answers the user can act on.

const BOOK = '11111111-1111-4111-8111-111111111111'
const T1 = '22222222-2222-4222-8222-222222222222'
const T2 = '33333333-3333-4333-8333-333333333333'
const NEW_TRANCHE = '44444444-4444-4444-8444-444444444444'
const SUCCESSOR = '55555555-5555-4555-8555-555555555555'

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  rpcResult: { data: { transaction_id: '44444444-4444-4444-8444-444444444444' } as unknown, error: null as unknown },
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  // What the preview asked the database for. Every filter and range, in order.
  selects: [] as { table: string; in?: { column: string; values: string[] }; range?: [number, number] }[],
  rowsFor: (_q: { in?: { column: string; values: string[] }; range?: [number, number] }) => [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ name, args })
      return { single: async () => h.rpcResult }
    },
    from: (table: string) => {
      const q: { table: string; in?: { column: string; values: string[] }; range?: [number, number] } = { table }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order']) builder[m] = () => builder
      builder.in = (column: string, values: string[]) => { q.in = { column, values }; return builder }
      builder.range = (from: number, to: number) => {
        q.range = [from, to]
        h.selects.push(q)
        return Promise.resolve({ data: h.rowsFor(q), error: null })
      }
      return builder
    },
  }),
}))

const { POST, GET } = await import('../route')

const BODY = {
  received_vnd: 12_500_000,
  interest_rate: 4.6,
  merge_date: '2026-08-01',
  tranche_ids: [T1, T2],
  tranche_principals: [8_000_000, 4_500_000],
  expected_successor_id: SUCCESSOR,
}

const call = (body: Record<string, unknown> = BODY) =>
  POST(
    new Request(`https://app.test/api/v1/investment-transactions/${BOOK}/merge-successor`, {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: BOOK }) },
  )

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.rpcResult = { data: { transaction_id: NEW_TRANCHE }, error: null }
  h.rpcCalls = []
  h.selects = []
  h.rowsFor = () => []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// A big book is the whole reason the preview reads from the server rather than
// from the goal page's capped list, so the read has to survive one.
describe('GET /api/v1/investment-transactions/[id]/merge-successor (#638)', () => {
  it('asks for withdrawals in bounded groups, whatever the book’s size', async () => {
    const trancheIds = Array.from({ length: 640 }, (_, i) =>
      `${(i + 1).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`)
    h.rowsFor = (q) => {
      if (q.in) return []
      const [from, to] = q.range!
      return trancheIds.slice(from, to + 1).map((id) => ({
        transaction_id: id, amount_vnd: 1_000_000, interest_rate: 4,
        investment_date: '2026-01-01', expiry_date: '2026-12-31',
        successor_deposit_tx_id: id === trancheIds[0] ? NEW_TRANCHE : null,
      }))
    }

    const res = await GET(
      new Request('https://app.test/x') as unknown as NextRequest,
      { params: Promise.resolve({ id: trancheIds[0] }) },
    )

    expect(res.status).toBe(200)
    const byId = h.selects.filter((q) => q.in)
    expect(byId.length).toBeGreaterThan(1)
    // One filter per group, never one filter carrying the whole book — that URL
    // is tens of kilobytes and the gateway rejects it before PostgREST sees it.
    for (const q of byId) expect(q.in!.values.length).toBeLessThanOrEqual(100)
    // ...and every tranche is still accounted for, across the groups.
    expect(byId.flatMap((q) => q.in!.values).sort()).toEqual([...trancheIds].sort())
  })
})

describe('POST /api/v1/investment-transactions/[id]/merge-successor (#638)', () => {
  it('hands the whole merge to the atomic RPC, tranches included', async () => {
    const res = await call()

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ transaction_id: NEW_TRANCHE })
    expect(h.rpcCalls[0]).toMatchObject({
      name: 'merge_book_into_successor',
      args: {
        p_source_book_id: BOOK,
        p_received_vnd: 12_500_000,
        p_interest_rate: 4.6,
        p_merge_date: '2026-08-01',
        p_tranche_ids: [T1, T2],
        p_tranche_principals: [8_000_000, 4_500_000],
        // The destination the user was looking at. The promise is cancellable,
        // so without this a replacement opened mid-confirmation would take the
        // cash while passing every other check.
        p_expected_successor_id: SUCCESSOR,
      },
    })
  })

  it('rejects an anonymous caller', async () => {
    h.user = null
    expect((await call()).status).toBe(401)
  })

  it.each([
    ['no tranches named', { ...BODY, tranche_ids: [] }],
    ['balances that do not match the tranches', { ...BODY, tranche_principals: [8_000_000] }],
    ['a rate of nothing', { ...BODY, interest_rate: null }],
    ['nothing received', { ...BODY, received_vnd: 0 }],
    ['a merge dated in the future', { ...BODY, merge_date: '2099-01-01' }],
    ['no destination named', { ...BODY, expected_successor_id: undefined }],
  ])('refuses %s before reaching the database', async (_label, body) => {
    const res = await call(body)

    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  // A top-up landing while the confirmation is open means the cash being
  // confirmed is not the cash the book holds.
  it('asks the client to reload when the book changed underneath', async () => {
    h.rpcResult = { data: null, error: { message: 'merge successor: book changed since load, reload and retry' } }

    const res = await call()

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ code: 'book_changed' })
  })

  it('passes on a rule the user can satisfy as a 400, not a fault', async () => {
    h.rpcResult = { data: null, error: { message: 'merge successor: this book has not matured yet' } }

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'this book has not matured yet', code: 'merge_refused',
    })
  })

  it('explains a successor that has closed its own door', async () => {
    h.rpcResult = {
      data: null,
      error: { message: 'accumulating top-up: this deposit no longer accepts top-ups: 20 days remain before maturity (its lock window is 30 days)' },
    }

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ code: 'successor_closed' })
  })

  it('reports a missing book as a 404', async () => {
    h.rpcResult = { data: null, error: { message: 'merge successor: accumulating book not found' } }

    expect((await call()).status).toBe(404)
  })
})
