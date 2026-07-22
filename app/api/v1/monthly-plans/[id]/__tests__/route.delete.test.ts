import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deleting a monthly plan must be a single atomic statement: the plan row, whose
// plan-scoped children all cascade (ON DELETE CASCADE) and whose investment
// transactions detach (ON DELETE SET NULL). The route must NOT hand-delete any
// child table first — that was the non-atomic bug (#472). This pins the handler
// to exactly one delete, on monthly_plans, and captures which tables it touches.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  planFetch: { data: { id: 'plan-1', month: 11, year: 2099, user_id: 'user-1' }, error: null } as {
    data: unknown
    error: unknown
  },
  planDeleteError: null as unknown,
  deletedTables: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => {
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      single: async () => h.planFetch,
      delete: () => {
        h.deletedTables.push(table)
        const del: Record<string, unknown> = {
          eq: () => del,
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ error: table === 'monthly_plans' ? h.planDeleteError : null }),
        }
        return del
      },
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => makeChain(table),
    }),
  }
})

import { DELETE } from '../route'

const VALID_ID = 'a3f1c2d4-0000-4000-8000-000000000000'
const ctx = (id = VALID_ID) => ({ params: Promise.resolve({ id }) })
const req = {} as unknown as Parameters<typeof DELETE>[0]

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.planFetch = { data: { id: 'plan-1', month: 11, year: 2099, user_id: 'user-1' }, error: null }
  h.planDeleteError = null
  h.deletedTables = []
})

describe('DELETE /api/v1/monthly-plans/[id] — atomic delete (#472)', () => {
  it('deletes only the plan row (children cascade), never a child table by hand', async () => {
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(200)
    // The whole fix: one delete, on monthly_plans — no manual fixed_expense_overrides pass.
    expect(h.deletedTables).toEqual(['monthly_plans'])
    expect(await res.json()).toMatchObject({
      data: { id: VALID_ID, status: 'deleted', month: 11, year: 2099 },
    })
  })

  it('returns 500 (and deletes nothing else) when the plan delete fails', async () => {
    h.planDeleteError = { message: 'boom' }
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(500)
    expect(h.deletedTables).toEqual(['monthly_plans'])
  })

  it('404s a missing plan without deleting anything', async () => {
    h.planFetch = { data: null, error: { message: 'no rows' } }
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(404)
    expect(h.deletedTables).toEqual([])
  })

  it('401s a plan owned by another user without deleting anything', async () => {
    h.planFetch = { data: { id: 'plan-1', month: 11, year: 2099, user_id: 'someone-else' }, error: null }
    const res = await DELETE(req, ctx())
    expect(res.status).toBe(401)
    expect(h.deletedTables).toEqual([])
  })

  it('400s a malformed id', async () => {
    const res = await DELETE(req, ctx('not-a-uuid'))
    expect(res.status).toBe(400)
    expect(h.deletedTables).toEqual([])
  })
})
