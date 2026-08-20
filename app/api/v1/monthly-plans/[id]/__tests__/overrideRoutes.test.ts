import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'

// Guard for #690. Monthly-plan overrides were three parallel route families —
// fixed expenses, recurring savings, insurance members — each repeating UUID
// parsing, auth, plan-ownership lookup, referenced-resource ownership, the
// upsert and the scoped delete. Security-sensitive duplication: the ownership
// and plan scoping have to stay identical whenever a fourth family or a new
// guard arrives.
//
// They had already drifted. The insurance family was copied without its DELETE
// (#467 added it later), its GET returned null instead of [] and skipped the
// ordering the other two apply.
//
// These tests state the invariants ONCE, over every family, so a new family
// inherits them by being registered rather than by being remembered.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  plan: { id: 'plan-1' } as { id: string } | null,
  rows: [] as unknown[],
  selectError: null as unknown,
  upsertError: null as unknown,
  deleteError: null as unknown,
  ownership: null as { status: number } | null,
  calls: [] as { table: string; op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][]; order?: string; projection?: string }[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chainFor = (table: string) => {
    const call = { table, op: 'select', filters: [] as [string, unknown][] } as (typeof h.calls)[number]
    h.calls.push(call)
    const chain: Record<string, unknown> = {
      select: (projection?: string) => { call.projection = projection; return chain },
      eq: (col: string, val: unknown) => { call.filters.push([col, val]); return chain },
      order: (col: string) => { call.order = col; return chain },
      upsert: (payload: unknown, opts: unknown) => { call.op = 'upsert'; call.payload = payload; call.opts = opts; return chain },
      delete: () => { call.op = 'delete'; return chain },
      single: async () =>
        table === 'monthly_plans'
          ? { data: h.plan, error: h.plan ? null : { message: 'no rows' } }
          : { data: h.rows[0] ?? null, error: h.upsertError },
      then: (resolve: (v: unknown) => void) =>
        resolve(
          call.op === 'delete'
            ? { data: null, error: h.deleteError }
            : { data: h.rows, error: h.selectError },
        ),
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chainFor(table),
    }),
  }
})

vi.mock('@/lib/assertOwned', () => ({
  ownershipError: async () =>
    h.ownership ? new Response(JSON.stringify({ error: 'forbidden' }), { status: h.ownership.status }) : null,
}))

const { FIXED_EXPENSE_OVERRIDES, RECURRING_SAVING_OVERRIDES, INSURANCE_OVERRIDES, overrideCollectionRoutes, overrideItemRoutes } =
  await import('../overrideRoutes')

const FAMILIES = [
  { name: 'fixed expenses', family: FIXED_EXPENSE_OVERRIDES, table: 'fixed_expense_overrides', bodyField: 'fixed_expense_id' },
  { name: 'recurring savings', family: RECURRING_SAVING_OVERRIDES, table: 'recurring_saving_overrides', bodyField: 'recurring_saving_id' },
  { name: 'insurance members', family: INSURANCE_OVERRIDES, table: 'plan_insurance_member_overrides', bodyField: 'member_id' },
]

const PLAN = '11111111-1111-4111-8111-111111111111'
const REF = '22222222-2222-4222-8222-222222222222'
const OVERRIDE = '33333333-3333-4333-8333-333333333333'

const req = (body?: unknown) =>
  new Request('https://app.test/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }) as unknown as NextRequest

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.plan = { id: 'plan-1' }
  h.rows = []
  h.selectError = null
  h.upsertError = null
  h.deleteError = null
  h.ownership = null
  h.calls = []
})

for (const { name, family, table, bodyField } of FAMILIES) {
  describe(`${name} overrides — the shared invariants (#690)`, () => {
    const { GET, POST } = overrideCollectionRoutes(family)
    const { DELETE } = overrideItemRoutes(family)
    const planParams = { params: Promise.resolve({ id: PLAN }) }
    const itemParams = { params: Promise.resolve({ id: PLAN, overrideId: OVERRIDE }) }

    it('refuses an unauthenticated caller before touching the database', async () => {
      h.user = null

      for (const res of [await GET(req(), planParams), await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 1 }), planParams), await DELETE(req(), itemParams)]) {
        expect(res.status).toBe(401)
      }
      expect(h.calls).toEqual([])
    })

    it('rejects a malformed plan id with 400, not 404', async () => {
      const bad = { params: Promise.resolve({ id: 'nope', overrideId: OVERRIDE }) }

      expect((await GET(req(), bad)).status).toBe(400)
      expect((await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 1 }), bad)).status).toBe(400)
      expect((await DELETE(req(), bad)).status).toBe(400)
    })

    it('answers 404 for a plan that is not the caller\'s', async () => {
      // The lookup is scoped by user_id, so someone else's plan is simply absent.
      h.plan = null

      expect((await GET(req(), planParams)).status).toBe(404)
      expect((await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 1 }), planParams)).status).toBe(404)
      expect((await DELETE(req(), itemParams)).status).toBe(404)
    })

    it('scopes every plan lookup by the caller', async () => {
      await GET(req(), planParams)

      const lookup = h.calls.find((c) => c.table === 'monthly_plans')!
      expect(lookup.filters).toEqual(expect.arrayContaining([['id', PLAN], ['user_id', 'user-1']]))
    })

    it('refuses a referenced record the caller does not own', async () => {
      // A valid UUID is not proof of ownership; the DB trigger (#525) would fire
      // mid-write, so this turns it into a clean 403.
      h.ownership = { status: 403 }

      const res = await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 1 }), planParams)

      expect(res.status).toBe(403)
      expect(h.calls.some((c) => c.table === table && c.op === 'upsert')).toBe(false)
    })

    it('returns an empty list rather than null when there are no overrides', async () => {
      h.rows = []

      const res = await GET(req(), planParams)

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual([])
    })

    it('orders the list so the response is stable', async () => {
      await GET(req(), planParams)

      expect(h.calls.find((c) => c.table === table)?.order).toBe('created_at')
    })

    it('upserts one override per resource per plan', async () => {
      h.rows = [{ id: OVERRIDE }]

      const res = await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 1234 }), planParams)

      expect(res.status).toBe(201)
      const write = h.calls.find((c) => c.op === 'upsert')!
      expect(write.table).toBe(table)
      expect(write.payload).toMatchObject({ plan_id: PLAN, [bodyField]: REF, monthly_amount_override_vnd: 1234 })
      expect(write.opts).toEqual({ onConflict: `plan_id,${bodyField}` })
    })

    it('requires the resource id', async () => {
      const res = await POST(req({ monthly_amount_override_vnd: 1 }), planParams)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: `${bodyField} is required` })
    })

    it('deletes only within the caller\'s plan', async () => {
      const res = await DELETE(req(), itemParams)

      expect(res.status).toBe(204)
      const del = h.calls.find((c) => c.op === 'delete')!
      expect(del.table).toBe(table)
      // Both filters, or an override id from another plan would be deletable.
      expect(del.filters).toEqual(expect.arrayContaining([['id', OVERRIDE], ['plan_id', PLAN]]))
    })

    it('treats deleting a missing override as done, consistently', async () => {
      // Idempotent: the caller asked for it to be gone and it is gone. All three
      // families answered this way already; now they cannot diverge.
      h.deleteError = null

      expect((await DELETE(req(), itemParams)).status).toBe(204)
    })
  })
}

describe('resource-specific amount rules stay explicit (#690)', () => {
  const planParams = { params: Promise.resolve({ id: PLAN }) }

  it('lets a fixed expense or a recurring saving be overridden to zero', async () => {
    // Zeroing an expense for one month is a legitimate plan edit.
    for (const { family, bodyField } of FAMILIES.slice(0, 2)) {
      h.calls = []
      h.rows = [{ id: OVERRIDE }]
      const { POST } = overrideCollectionRoutes(family)

      const res = await POST(req({ [bodyField]: REF, monthly_amount_override_vnd: 0 }), planParams)

      expect(res.status).toBe(201)
    }
  })

  it('refuses a zero insurance premium', async () => {
    // An insurance member with a zero premium is not a plan edit, it is a
    // member who should not be in the plan.
    const { POST } = overrideCollectionRoutes(INSURANCE_OVERRIDES)

    const res = await POST(req({ member_id: REF, monthly_amount_override_vnd: 0 }), planParams)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Monthly amount must be positive' })
  })

  it('rejects a missing amount in every family', async () => {
    for (const { family, bodyField } of FAMILIES) {
      const { POST } = overrideCollectionRoutes(family)

      const res = await POST(req({ [bodyField]: REF }), planParams)

      expect(res.status).toBe(400)
    }
  })
})

describe('only insurance skips updated_at, and only because it has no such column (#690)', () => {
  const planParams = { params: Promise.resolve({ id: PLAN }) }

  it('stamps updated_at where the table has one', async () => {
    for (const { family } of FAMILIES.slice(0, 2)) {
      h.calls = []
      h.rows = [{ id: OVERRIDE }]
      const { POST } = overrideCollectionRoutes(family)
      await POST(req({ [family.bodyField]: REF, monthly_amount_override_vnd: 1 }), planParams)

      expect(h.calls.find((c) => c.op === 'upsert')!.payload).toHaveProperty('updated_at')
    }
  })

  it('does not invent an updated_at the insurance table cannot store', async () => {
    h.rows = [{ id: OVERRIDE }]
    const { POST } = overrideCollectionRoutes(INSURANCE_OVERRIDES)

    await POST(req({ member_id: REF, monthly_amount_override_vnd: 1 }), planParams)

    expect(h.calls.find((c) => c.op === 'upsert')!.payload).not.toHaveProperty('updated_at')
  })
})

// The structural half of #690: the invariants above only protect a family that
// actually goes through the factory. Insurance shipped without its DELETE for a
// release (#467) precisely because nothing noticed a missing file.
describe('every override family is registered, not hand-rolled (#690)', () => {
  const dir = path.join(__dirname, '..')
  const families = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-overrides'))
    .map((e) => e.name)

  it('finds the families this suite claims to cover', () => {
    // If a fourth family appears, this fails until it is added to FAMILIES above
    // — which is the point: the invariants are opt-out, not opt-in.
    expect(families.sort()).toEqual(['fixed-expense-overrides', 'insurance-overrides', 'recurring-saving-overrides'])
  })

  it.each(families)('%s exposes GET and POST through the shared factory', (name) => {
    const source = readFileSync(path.join(dir, name, 'route.ts'), 'utf8')

    expect(source).toMatch(/overrideCollectionRoutes\(/)
    expect(source).toMatch(/export const \{ GET, POST \}/)
    // No route may reach for the database on its own: that is how the copies
    // drifted apart in the first place.
    expect(source).not.toMatch(/createSupabaseServerClient/)
  })

  it.each(families)('%s has a DELETE, through the same factory', (name) => {
    const file = path.join(dir, name, '[overrideId]', 'route.ts')
    expect(existsSync(file), `${name} has no [overrideId] route — "restore" would silently 404`).toBe(true)

    const source = readFileSync(file, 'utf8')
    expect(source).toMatch(/overrideItemRoutes\(/)
    expect(source).toMatch(/export const \{ DELETE \}/)
    expect(source).not.toMatch(/createSupabaseServerClient/)
  })
})
