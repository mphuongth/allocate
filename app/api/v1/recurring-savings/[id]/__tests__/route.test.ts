import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Guard for #686 — the recurring-saving half of the same bug. `PUT
// { effective_from }` alone compared the new endpoint against null instead of
// the stored `effective_to`, passed the route, and was refused by
// `recurring_savings_check`; the catch-all called that "Recurring saving not
// found" about a row that is right there.
//
// The merge rule is unit-tested in lib/__tests__/effectiveRange.test.ts. These
// tests pin the wiring, and that the range read does not disturb the goal /
// linked-deposit checks that already live in this route.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  stored: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  updateError: null as { code?: string; message?: string } | null,
  selects: [] as string[],
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = () => {
    let payload: Record<string, unknown> | null = null
    const chain: Record<string, unknown> = {
      select: (columns?: string) => {
        if (!payload) h.selects.push(columns ?? '')
        return chain
      },
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

const ID = '22222222-2222-4222-8222-222222222222'

/** Reads issued before the write — the range pre-read is the one naming dates. */
const rangeReads = () => h.selects.filter((columns) => columns.includes('effective_from'))

const put = (body: unknown, id: string = ID) =>
  PUT(
    new Request(`https://app.test/api/v1/recurring-savings/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id }) },
  )

describe('PUT /api/v1/recurring-savings/[id] — effective range (#686)', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.stored = { effective_from: '2026-03-01', effective_to: '2026-06-01' }
    h.updated = { saving_id: ID, name: 'Monthly deposit' }
    h.updateError = null
    h.selects = []
    h.updates = []
  })

  it('rejects a from moved past the stored to', async () => {
    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: '"Active from" must be before "Active until".',
    })
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
    expect(h.updates[0]).toMatchObject({ effective_from: '2026-06-01' })
  })

  it('accepts a to that still lands on or after the stored from', async () => {
    const res = await put({ effective_to: '2026-03' })

    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ effective_to: '2026-03-01' })
  })

  it('lets an endpoint be cleared without reading the row', async () => {
    const res = await put({ effective_from: null })

    expect(res.status).toBe(200)
    expect(h.updates[0]).toMatchObject({ effective_from: null })
    expect(rangeReads()).toEqual([])
  })

  it('judges a body carrying both endpoints without reading the row', async () => {
    const res = await put({ effective_from: '2026-08', effective_to: '2026-07' })

    expect(res.status).toBe(400)
    expect(rangeReads()).toEqual([])
    expect(h.updates).toEqual([])
  })

  it('reads nothing when the update leaves the range alone', async () => {
    const res = await put({ name: 'Monthly deposit' })

    expect(res.status).toBe(200)
    expect(rangeReads()).toEqual([])
  })

  it('still answers 404 for a row that is missing or not the caller\'s', async () => {
    h.stored = null
    h.updated = null

    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Recurring saving not found' })
  })

  it('answers 400, not 404, when the table refuses the range under a race', async () => {
    h.updated = null
    h.updateError = {
      code: '23514',
      message: 'new row for relation "recurring_savings" violates check constraint "recurring_savings_check"',
    }

    const res = await put({ effective_from: '2026-05' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: '"Active from" must be before "Active until".',
    })
  })

  it('leaves the linked-deposit refusal path intact', async () => {
    // A different write refusal on the same route still has to keep its own
    // message — the range mapping must not swallow it.
    h.updated = null
    h.updateError = { message: 'closed deposit: cannot link' }

    const res = await put({ effective_from: '2026-05' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'That deposit has been closed — link a live deposit instead.',
    })
  })

  it('returns 401 when unauthenticated', async () => {
    h.user = null

    const res = await put({ effective_from: '2026-07' })

    expect(res.status).toBe(401)
    expect(rangeReads()).toEqual([])
  })

  it('rejects a malformed month before any database work', async () => {
    const res = await put({ effective_to: '2026-00' })

    expect(res.status).toBe(400)
    expect(rangeReads()).toEqual([])
    expect(h.updates).toEqual([])
  })
})
