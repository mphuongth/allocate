import { describe, it, expect, vi, beforeEach } from 'vitest'

// A partial dashboard read must never (a) return an understated 200 nor
// (b) overwrite today's net-worth snapshot with the incomplete value (#513).
// We drive the real GET handler over a mocked Supabase whose per-table result
// is configurable, and assert the error gate + snapshot-write guard.
//
// The handler issues, roughly:
//   from(table).select(...).eq(...)                    -> awaited (thenable)
//   from('gold_price_settings').select().eq().single() -> .single()
//   from('net_worth_snapshots').select().eq().eq().maybeSingle()
//   from('plan_*').select().in(...)                    -> awaited (only if planIds)
//   from('net_worth_snapshots').upsert(row).then(...)  -> the snapshot write
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  tables: {} as Record<string, { data: unknown; error: unknown }>,
  upsertCalls: [] as unknown[],
}))

vi.mock('@/lib/supabase-server', () => {
  function chainFor(name: string) {
    const result = () => h.tables[name] ?? { data: [], error: null }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => void) => resolve(result()),
      upsert: (row: unknown) => {
        if (name === 'net_worth_snapshots') h.upsertCalls.push(row)
        return { then: (r: (v: unknown) => void) => r({ error: null }) }
      },
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (name: string) => chainFor(name),
    }),
  }
})

import { GET } from '../route'

const ERR = { code: 'XX000', message: 'connection reset' }

/** Reset every table to a valid, empty-but-successful result. */
function baseHappy() {
  h.tables = {
    monthly_plans: { data: [], error: null },
    savings_goals: { data: [], error: null },
    active_investment_transactions: { data: [], error: null },
    insurance_members: { data: [], error: null },
    insurance_savings: { data: [], error: null },
    recurring_savings: { data: [], error: null },
    gold_price_settings: { data: null, error: null },
    net_worth_snapshots: { data: null, error: null },
    plan_excluded_insurance_members: { data: [], error: null },
    plan_insurance_member_overrides: { data: [], error: null },
    recurring_saving_overrides: { data: [], error: null },
    recurring_saving_fulfillments: { data: [], error: null },
  }
}

/** A single monthly plan so the plan-scoped override queries actually run. */
function withOnePlan() {
  const now = new Date()
  h.tables.monthly_plans = {
    data: [{ id: 'p1', month: now.getMonth() + 1, year: now.getFullYear() }],
    error: null,
  }
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.upsertCalls = []
  baseHappy()
})

describe('GET /api/v1/dashboard/overview — partial reads never corrupt snapshots (#513)', () => {
  it('returns 200 and writes a snapshot when every source loads', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.upsertCalls).toHaveLength(1)
  })

  // Each required source, when it fails, must 500 AND leave the snapshot alone.
  const requiredAlwaysRun = [
    'monthly_plans',
    'savings_goals',
    'active_investment_transactions',
    'insurance_members',
    'insurance_savings',
    'recurring_savings',
    'recurring_saving_fulfillments',
    'net_worth_snapshots',
  ] as const

  for (const table of requiredAlwaysRun) {
    it(`returns 500 and writes no snapshot when ${table} fails`, async () => {
      h.tables[table] = { data: null, error: ERR }
      const res = await GET()
      expect(res.status).toBe(500)
      expect(h.upsertCalls).toHaveLength(0)
    })
  }

  // The plan-scoped queries only run when at least one plan exists.
  const requiredPlanScoped = [
    'plan_excluded_insurance_members',
    'plan_insurance_member_overrides',
    'recurring_saving_overrides',
  ] as const

  for (const table of requiredPlanScoped) {
    it(`returns 500 and writes no snapshot when ${table} fails`, async () => {
      withOnePlan()
      h.tables[table] = { data: null, error: ERR }
      const res = await GET()
      expect(res.status).toBe(500)
      expect(h.upsertCalls).toHaveLength(0)
    })
  }
})

describe('GET /api/v1/dashboard/overview — optional gold price (#513)', () => {
  it('still returns 200 when gold_price_settings has no row (PGRST116)', async () => {
    h.tables.gold_price_settings = { data: null, error: { code: 'PGRST116' } }
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.upsertCalls).toHaveLength(1)
  })

  it('returns 500 for a real gold_price_settings error (not a missing row)', async () => {
    h.tables.gold_price_settings = { data: null, error: ERR }
    const res = await GET()
    expect(res.status).toBe(500)
    expect(h.upsertCalls).toHaveLength(0)
  })
})
