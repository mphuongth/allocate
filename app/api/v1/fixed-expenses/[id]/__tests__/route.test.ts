import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Guard for #686. The PUT validated the effective range using only the fields
// the body carried, so `PUT { effective_from: '2026-07' }` on a row that ends
// 2026-06 compared the new endpoint against null, passed, and was refused by
// `effective_dates_order` — which the catch-all reported as 404 "Expense not
// found" about a row that is right there.
//
// The merge rule itself is unit-tested in lib/__tests__/effectiveRange.test.ts.
// What these tests pin is the wiring: that the route reads the stored row when
// (and only when) it has to, answers 400 rather than reaching the table, and
// still answers 404 for a row that isn't the caller's.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  stored: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  updateError: null as { code?: string; message?: string } | null,
  reads: 0,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = () => {
    let payload: Record<string, unknown> | null = null
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      update: (values: Record<string, unknown>) => {
        payload = values
        return chain
      },
      single: async () => {
        if (payload) {
          h.updates.push(payload)
          return { data: h.updated, error: h.updateError }
        }
        h.reads++
        return { data: h.stored, error: h.stored ? null : { message: 'no rows' } }
      },
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: () => chainFor(),
    }),
  }
})

const { PUT } = await import('../route')

const ID = '11111111-1111-4111-8111-111111111111'

const put = (body: unknown, id: string = ID) =>
  PUT(
    new Request(`https://app.test/api/v1/fixed-expenses/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

describe('PUT /api/v1/fixed-expenses/[id] — effective range (#686)', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    // A row that runs March → June 2026.
    h.stored = { effective_from: '2026-03-01', effective_to: '2026-06-01' }
    h.updated = { expense_id: ID, expense_name: 'Rent' }
    h.updateError = null
    h.reads = 0
    h.updates = []
  })

  it('rejects a from moved past the stored to', async () => {
    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: '"Active from" must be before "Active until".',
    })
    // The refusal has to happen before the write, or the table answers instead
    // and the caller gets a 404 about an existing row.
    expect(h.updates).toEqual([])
  })

  it('rejects a to moved before the stored from', async () => {
    const res = await put({ effective_to: '2026-02' })

    expect(res.status).toBe(400)
    expect(h.updates).toEqual([])
  })

  it('accepts a from that still lands on or before the stored to', async () => {
    const res = await put({ effective_from: '2026-06' })

    expect(res.status).toBe(200)
    expect(h.updates).toHaveLength(1)
    expect(h.updates[0]).toMatchObject({ effective_from: '2026-06-01' })
  })

  it('accepts a to that still lands on or after the stored from', async () => {
    const res = await put({ effective_to: '2026-03' })

    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ effective_to: '2026-03-01' })
  })

  it('lets an endpoint be cleared without reading the row', async () => {
    // NULL disables the CHECK on that side, so clearing can never invert the
    // range — no round trip earns its keep here.
    const cleared = await put({ effective_from: null })

    expect(cleared.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ effective_from: null })
    expect(h.reads).toBe(0)

    const clearedTo = await put({ effective_to: null })
    expect(clearedTo.status).toBe(200)
    expect(h.reads).toBe(0)
  })

  it('judges a body carrying both endpoints without reading the row', async () => {
    const res = await put({ effective_from: '2026-08', effective_to: '2026-07' })

    expect(res.status).toBe(400)
    expect(h.reads).toBe(0)
    expect(h.updates).toEqual([])
  })

  it('reads nothing when the update leaves the range alone', async () => {
    const res = await put({ expense_name: 'Rent' })

    expect(res.status).toBe(200)
    expect(h.reads).toBe(0)
  })

  it('still answers 404 for a row that is missing or not the caller\'s', async () => {
    // The pre-read finds nothing; the update then matches nothing either. A
    // foreign id behaves the same way — .eq(user_id) scopes both statements.
    h.stored = null
    h.updated = null

    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Expense not found' })
  })

  it('answers 400, not 404, when the table refuses the range under a race', async () => {
    // A concurrent update can move the other endpoint between the read and the
    // write. Then the table is the one that says no — and that is still a
    // validation failure, not a missing row (#532/#533).
    h.updated = null
    h.updateError = {
      code: '23514',
      message: 'new row for relation "fixed_expenses" violates check constraint "effective_dates_order"',
    }

    const res = await put({ effective_from: '2026-05' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: '"Active from" must be before "Active until".',
    })
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null

    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(401)
    expect(h.reads).toBe(0)
  })

  it('rejects a malformed month before any database work', async () => {
    const res = await put({ effective_from: '2026-13' })

    expect(res.status).toBe(400)
    expect(h.reads).toBe(0)
    expect(h.updates).toEqual([])
  })
})
