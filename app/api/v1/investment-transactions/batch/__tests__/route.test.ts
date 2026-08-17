import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { BULK_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES } from '@/lib/apiBody'

// Every write route is bounded by default now (#682), and this is one of the two
// whose body is a list sized by the user's data rather than by a fixed set of
// fields: the Excel-paste importer sends up to 500 rows in a single request. A
// cap sized for a form submission would turn a working import into a 413, so
// batch carries an explicit, larger one — and the number has to stay provably
// big enough for the 500 rows the route itself allows.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  funds: [{ id: '550e8400-e29b-41d4-a716-446655440000' }] as { id: string }[],
  inserted: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = () => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      in: () => c,
      insert: async (rows: unknown[]) => {
        h.inserted = rows
        return { error: null }
      },
      then: (resolve: (v: unknown) => void) => resolve({ data: h.funds, error: null }),
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

const { POST } = await import('../route')

const FUND_ID = '550e8400-e29b-41d4-a716-446655440000'

/** A row shaped exactly like the importer's — same five fields, same types. */
const row = (i: number) => ({
  fund_id: FUND_ID,
  investment_date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
  // Deliberately wide: nine-figure amounts and four-decimal unit prices are the
  // realistic worst case for how many bytes a row costs.
  amount_vnd: 123_456_789,
  unit_price: 12_345.6789,
  units: 9_876.5432,
})

const post = (body: string) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions/batch', {
    method: 'POST',
    body,
  }))

beforeEach(() => {
  h.inserted = []
})

describe('POST /api/v1/investment-transactions/batch — body limit', () => {
  const fullImport = JSON.stringify({
    transactions: Array.from({ length: 500 }, (_, i) => row(i)),
  })

  it('accepts the largest import the route itself allows', async () => {
    const res = await post(fullImport)

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ inserted: 500, errors: [] })
    expect(h.inserted).toHaveLength(500)
  })

  // The assertion above proves the cap admits this payload; this one says why
  // there is margin rather than a number chosen to just barely fit. If a future
  // row grows a field, this fails long before real imports start 413-ing.
  it('leaves room to spare for a 500-row payload', () => {
    const bytes = new TextEncoder().encode(fullImport).byteLength

    expect(bytes).toBeLessThan(BULK_MAX_BODY_BYTES / 4)
  })

  it('raises the default rather than living under it', () => {
    expect(BULK_MAX_BODY_BYTES).toBeGreaterThan(DEFAULT_MAX_BODY_BYTES)
  })

  // Bulky is not unbounded: past its own cap the import is refused with a 413
  // like everything else, before the array is parsed or a row is validated.
  it('still refuses a body past its own cap with 413', async () => {
    const res = await post(`{"pad":"${'x'.repeat(BULK_MAX_BODY_BYTES)}"}`)

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Request body too large' })
    expect(h.inserted).toHaveLength(0)
  })
})
