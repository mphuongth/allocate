import { describe, it, expect, vi, beforeEach } from 'vitest'

// A `?full=true` monthly-plan read fires 14 child queries in parallel. A single
// failed child must not be silently converted to an empty collection — that
// makes real data look deleted behind an HTTP 200 (#514). The handler must fail
// closed with a 500 instead.
//
// We drive the real GET over a mocked Supabase whose per-source result is
// configurable. `investment_transactions` is queried twice (asset_type 'fund'
// vs 'bank'), so the mock disambiguates on the captured eq('asset_type', …).
// DCA seeding is an atomic RPC (`seed_and_sync_plan_dca`) that runs first with
// its own error check, so it's mocked separately.
const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  plan: { id: 'plan-1', month: 6, year: 2026, user_id: 'user-1' } as Record<string, unknown> | null,
  planError: null as unknown,
  seedError: null as unknown,
  results: {} as Record<string, { data: unknown; error: unknown }>,
}))

// table name -> response key (investment_transactions handled separately)
const TABLE_KEY: Record<string, string> = {
  fixed_expense_overrides: 'fixed_expense_overrides',
  fixed_expenses: 'fixed_expenses',
  insurance_members: 'insurance_members',
  plan_excluded_insurance_members: 'excluded_insurance',
  plan_insurance_member_overrides: 'insurance_overrides',
  savings_goals: 'goals',
  funds: 'funds',
  plan_other_expenses: 'other_expenses',
  recurring_savings: 'recurring_savings',
  recurring_saving_overrides: 'recurring_saving_overrides',
  plan_dca_skips: 'dca_skips',
  recurring_saving_fulfillments: 'recurring_fulfillments',
}

vi.mock('@/lib/supabase-server', () => {
  const get = (key: string) => h.results[key] ?? { data: [], error: null }
  function chainFor(name: string) {
    const filters: Record<string, unknown> = {}
    const resolveList = () => {
      if (name === 'investment_transactions') {
        return filters.asset_type === 'bank' ? get('direct_savings') : get('fund_investments')
      }
      return get(TABLE_KEY[name] ?? name)
    }
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters[col] = val; return chain },
      or: () => chain,
      order: () => chain,
      in: () => chain,
      maybeSingle: async () => ({ data: h.plan, error: h.planError }),
      then: (resolve: (v: unknown) => void) => resolve(resolveList()),
    }
    return chain
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (name: string) => chainFor(name),
      rpc: async () => ({ error: h.seedError }),
    }),
  }
})

import { GET } from '../route'
import type { NextRequest } from 'next/server'

const ERR = { code: 'XX000', message: 'connection reset' }

function req(full = true): NextRequest {
  const url = `http://localhost/api/v1/monthly-plans?month=6&year=2026${full ? '&full=true' : ''}`
  return { url } as unknown as NextRequest
}

/** All 14 child sources succeed with empty data. */
function baseHappy() {
  h.results = {
    fund_investments: { data: [], error: null },
    direct_savings: { data: [], error: null },
    fixed_expense_overrides: { data: [], error: null },
    fixed_expenses: { data: [], error: null },
    insurance_members: { data: [], error: null },
    excluded_insurance: { data: [], error: null },
    insurance_overrides: { data: [], error: null },
    goals: { data: [], error: null },
    funds: { data: [], error: null },
    other_expenses: { data: [], error: null },
    recurring_savings: { data: [], error: null },
    recurring_saving_overrides: { data: [], error: null },
    dca_skips: { data: [], error: null },
    recurring_fulfillments: { data: [], error: null },
  }
}

beforeEach(() => {
  h.user = { id: 'user-1' }
  h.plan = { id: 'plan-1', month: 6, year: 2026, user_id: 'user-1' }
  h.planError = null
  h.seedError = null
  baseHappy()
})

// Every child-query group; the failing source's error goes on this response key.
const CHILD_GROUPS = [
  'fund_investments',
  'direct_savings',
  'fixed_expense_overrides',
  'fixed_expenses',
  'insurance_members',
  'excluded_insurance',
  'insurance_overrides',
  'goals',
  'funds',
  'other_expenses',
  'recurring_savings',
  'recurring_saving_overrides',
  'dca_skips',
  'recurring_fulfillments',
] as const

describe('GET /api/v1/monthly-plans?full=true — fail closed on child-query failure (#514)', () => {
  it('returns 200 with all collections when every child query succeeds', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.goals).toEqual([])
    expect(body.fund_investments).toEqual([])
  })

  for (const group of CHILD_GROUPS) {
    it(`returns 500 (not a partial 200) when ${group} fails`, async () => {
      h.results[group] = { data: null, error: ERR }
      const res = await GET(req())
      expect(res.status).toBe(500)
      // Stable, actionable error — never leak internal details to the client.
      const body = await res.json()
      expect(body.error).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('XX000')
    })
  }

  it('returns 500 when DCA seeding (RPC) fails, before reading children', async () => {
    h.seedError = ERR
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('still returns the bare plan (200) for a non-full request without touching children', async () => {
    h.results.goals = { data: null, error: ERR } // would 500 if children were read
    const res = await GET(req(false))
    expect(res.status).toBe(200)
  })

  it('returns 404 when the plan does not exist', async () => {
    h.plan = null
    const res = await GET(req())
    expect(res.status).toBe(404)
  })
})
